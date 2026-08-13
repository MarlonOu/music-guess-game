#!/usr/bin/env node
/**
 * 讀取一份歌曲 CSV（格式對應 /admin 頁面「匯出 CSV」/「匯入 CSV」的標準格式，
 * 見 lib/csv/songCsv.ts：title,artist,youtubeVideoId,durationSec,themes,lyrics），
 * 對每一列 youtubeVideoId 空白的資料，用 title + artist 呼叫 YouTube Data API v3
 * （search.list）查詢最相關的影片，補回 youtubeVideoId 欄位，輸出成一份新的 CSV。
 *
 * 同一個「歌名＋歌手」只會查一次（即使 CSV 裡因為多個主題分類重複出現很多列），
 * 查到的結果會套用到所有相同歌名＋歌手的列，避免浪費配額重複查詢同一首歌。
 *
 * ⚠️ 這是自動化查詢，結果務必人工核對：抓到的可能是翻唱版、Cover、直播剪輯、
 * Lyric Video 而非正式版本。腳本輸出時會列出比對到的實際影片標題與頻道名稱，
 * 請對照確認後再把輸出的 CSV 匯入資料庫（不要跳過人工核對直接匯入）。
 *
 * 使用前置：
 * 1. 於 Google Cloud Console 建立專案，啟用「YouTube Data API v3」，取得 API Key
 *    https://console.cloud.google.com/apis/library/youtube.googleapis.com
 * 2. 在專案根目錄 .env（已列入 .gitignore，不會進版控）加入：
 *    YOUTUBE_API_KEY=你的金鑰
 *
 * 使用方式：
 *   node --env-file=.env scripts/populate-youtube-ids.mjs <輸入CSV路徑> [輸出CSV路徑]
 *   node --env-file=.env scripts/populate-youtube-ids.mjs songs.csv songs-filled.csv
 *   node --env-file=.env scripts/populate-youtube-ids.mjs songs.csv songs-filled.csv --dry-run
 *   node --env-file=.env scripts/populate-youtube-ids.mjs songs.csv songs-filled.csv --force
 *
 * 省略輸出路徑時，預設寫回輸入檔案同目錄下、檔名加上 -filled 後綴。
 *
 * 免費額度：YouTube Data API v3 預設每日配額 10,000 units，search.list 每次查詢消耗 100 units，
 * 換算每天約可查詢 100 首「不重複」的歌（重複列不會重複扣配額），題庫較大時請分批執行，
 * 這次沒查完的下次直接用同一份輸出檔案當輸入重跑，已經有 videoId 的列會自動跳過（除非加 --force）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';

const SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
// 跟 populate-youtube-ids 舊版留下的示範佔位 id 一併視為「需要重新查詢」，避免誤判成已完成
const PLACEHOLDER_IDS = new Set(['dQw4w9WgXcQ', 'jNQXAC9IVRw', '9bZkp7q19f0']);

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const isDryRun = process.argv.includes('--dry-run');
const isForce = process.argv.includes('--force');

const inputPath = args[0];
if (!inputPath) {
  console.error('用法：node --env-file=.env scripts/populate-youtube-ids.mjs <輸入CSV路徑> [輸出CSV路徑]');
  process.exitCode = 1;
  process.exit();
}
const outputPath =
  args[1] ??
  (() => {
    const ext = path.extname(inputPath);
    const base = inputPath.slice(0, -ext.length || undefined);
    return `${base}-filled${ext || '.csv'}`;
  })();

async function searchVideoId(query, apiKey) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('videoCategoryId', '10'); // 音樂分類，比照 /admin 搜尋功能的做法
  url.searchParams.set('q', query);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API 回應錯誤 ${res.status}：${body}`);
  }
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) return null;
  return {
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
  };
}

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('缺少 YOUTUBE_API_KEY 環境變數。請參考本檔案開頭註解設定。');
    process.exitCode = 1;
    return;
  }

  const raw = await readFile(inputPath, 'utf-8');
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (parsed.errors.length > 0) {
    console.error('CSV 解析錯誤：', parsed.errors[0]);
    process.exitCode = 1;
    return;
  }
  const rows = parsed.data;

  // 同一首歌（歌名+歌手）只查一次，查到的結果套用到所有相同歌名+歌手的列
  const queryCache = new Map();
  let queriedCount = 0;
  let filledCount = 0;

  for (const row of rows) {
    const title = (row.title ?? '').trim();
    const artist = (row.artist ?? '').trim();
    const currentId = (row.youtubeVideoId ?? '').trim();

    if (!title || !artist) {
      console.warn(`跳過（缺 title 或 artist）：${JSON.stringify(row)}`);
      continue;
    }

    const needsQuery = !currentId || PLACEHOLDER_IDS.has(currentId) || isForce;
    if (!needsQuery) continue;

    const cacheKey = `${title}\u0000${artist}`;
    if (queryCache.has(cacheKey)) {
      const cached = queryCache.get(cacheKey);
      if (cached && !isDryRun) {
        row.youtubeVideoId = cached.videoId;
        filledCount += 1;
      }
      continue;
    }

    const query = `${title} ${artist}`.trim();
    try {
      queriedCount += 1;
      const result = await searchVideoId(query, apiKey);
      queryCache.set(cacheKey, result);
      if (!result) {
        console.warn(`查無結果：「${query}」`);
        continue;
      }
      console.log(`${title}（${artist}）→ ${result.videoId}  [${result.channelTitle} - ${result.title}]`);
      if (!isDryRun) {
        row.youtubeVideoId = result.videoId;
        filledCount += 1;
      }
    } catch (err) {
      console.error(`查詢失敗：「${query}」`, err instanceof Error ? err.message : err);
      queryCache.set(cacheKey, null);
    }
  }

  console.log(`\n共查詢 ${queriedCount} 個不重複的「歌名+歌手」組合，補上 ${filledCount} 列的 youtubeVideoId。`);

  if (isDryRun) {
    console.log('--dry-run 模式，未寫入檔案。');
    return;
  }

  const outCsv = Papa.unparse({ fields: Object.keys(rows[0] ?? {}), data: rows });
  await writeFile(outputPath, '\uFEFF' + outCsv, 'utf-8');
  console.log(`已寫入：${outputPath}`);
  console.log('⚠️ 請人工核對上方列出的比對結果（頻道名稱、影片標題）是否正確，再匯入 /admin 頁面。');
}

main();
