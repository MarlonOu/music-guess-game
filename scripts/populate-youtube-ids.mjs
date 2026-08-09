#!/usr/bin/env node
/**
 * 依 data/songs.json 中每首歌的 title + 對應 artist name，
 * 呼叫 YouTube Data API v3（search.list）查詢最相關的影片，寫回 youtubeVideoId 欄位。
 *
 * 使用前置：
 * 1. 於 Google Cloud Console 建立專案，啟用「YouTube Data API v3」，取得 API Key
 *    https://console.cloud.google.com/apis/library/youtube.googleapis.com
 * 2. 在專案根目錄 .env（已列入 .gitignore，不會進版控）加入：
 *    YOUTUBE_API_KEY=你的金鑰
 *
 * 使用方式：
 *   node --env-file=.env scripts/populate-youtube-ids.mjs
 *   node --env-file=.env scripts/populate-youtube-ids.mjs --dry-run   # 只印出查詢結果，不寫入檔案
 *   node --env-file=.env scripts/populate-youtube-ids.mjs --force     # 連已有 youtubeVideoId 的歌曲也重新查詢
 *
 * 免費額度：YouTube Data API v3 預設每日配額 10,000 units，search.list 每次查詢消耗 100 units，
 * 換算每天約可查詢 100 首歌，題庫較大時請分批執行。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SONGS_JSON_PATH = path.resolve(import.meta.dirname, '../data/songs.json');
const SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');

async function searchVideoId(query, apiKey) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '1');
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

  const raw = await readFile(SONGS_JSON_PATH, 'utf-8');
  const data = JSON.parse(raw);
  const artistById = new Map(data.artists.map((a) => [a.id, a.name]));

  let changedCount = 0;

  for (const song of data.songs) {
    const isPlaceholder = ['dQw4w9WgXcQ', 'jNQXAC9IVRw', '9bZkp7q19f0'].includes(song.youtubeVideoId);
    if (song.youtubeVideoId && !isPlaceholder && !isForce) {
      console.log(`跳過（已有真實 videoId）：${song.title}`);
      continue;
    }

    const artistName = artistById.get(song.artistId) ?? '';
    const query = `${song.title} ${artistName}`.trim();

    try {
      const result = await searchVideoId(query, apiKey);
      if (!result) {
        console.warn(`查無結果：「${query}」`);
        continue;
      }
      console.log(
        `${song.title}（${artistName}）→ ${result.videoId}  [${result.channelTitle} - ${result.title}]`
      );
      if (!isDryRun) {
        song.youtubeVideoId = result.videoId;
        changedCount += 1;
      }
    } catch (err) {
      console.error(`查詢失敗：「${query}」`, err instanceof Error ? err.message : err);
    }
  }

  if (isDryRun) {
    console.log('\n--dry-run 模式，未寫入檔案。');
    return;
  }

  if (changedCount === 0) {
    console.log('\n無變更，未寫入檔案。');
    return;
  }

  await writeFile(SONGS_JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`\n已寫入 ${changedCount} 首歌的 youtubeVideoId 至 ${SONGS_JSON_PATH}`);
}

main();
