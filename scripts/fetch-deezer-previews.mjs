#!/usr/bin/env node
/**
 * 讀取一份歌曲 CSV（格式對應 /admin 頁面「匯出 CSV」/「匯入 CSV」的標準格式，
 * 見 lib/csv/songCsv.ts：title,artist,youtubeVideoId,appleMusicTrackId,appleMusicPreviewUrl,
 * deezerTrackId,deezerPreviewUrl,durationSec,themes,lyrics），對每一列 deezerPreviewUrl 空白的
 * 資料，用 title + artist 呼叫 Deezer 公開搜尋 API 查詢最相關的曲目，補回
 * deezerTrackId／deezerPreviewUrl 兩個欄位，輸出成一份新的 CSV。
 *
 * 這是 Apple Music 目錄沒收錄這首歌時的第二層備援（見 lib/audio/resolvePlaybackTarget.ts
 * 的優先序說明），建議先跑過 scripts/fetch-apple-previews.mjs、把還是查不到 Apple Music 來源
 * 的歌曲留白，再用這支腳本補 Deezer——不過這支腳本本身不管 appleMusicPreviewUrl 有沒有值，
 * 一律針對 deezerPreviewUrl 空白的列查詢，兩邊都想收錄也沒問題（播放時實際優先用 Apple Music，
 * 見 resolvePlaybackTarget.ts，Deezer 純粹是備援，多收錄不影響現有播放行為）。
 *
 * 同一個「歌名＋歌手」只會查一次（即使 CSV 裡因為多個主題分類重複出現很多列），
 * 查到的結果會套用到所有相同歌名＋歌手的列，避免浪費請求重複查詢同一首歌。
 *
 * ⚠️ 這是自動化查詢，結果務必人工核對：抓到的可能是翻唱版、Live 版、Remix、
 * 精選輯重新收錄版而非原唱正式版本，尤其歌名／歌手比對出來「不夠像」的列，
 * 腳本會特別標記為「低信心」，這些列請務必打開輸出結果聽過試聽再決定要不要留。
 *
 * 不需要申請任何 API 金鑰——Deezer Search API 是公開、免驗證的服務，跟 iTunes Search API 同類型。
 * 官方沒有硬性公告配額上限，但建議保守一點的呼叫頻率（--delay 預設值已對齊），
 * 太密集呼叫可能被暫時限流，被限流時腳本會自動重試一次、等更久再送出。
 *
 * 使用方式：
 *   node scripts/fetch-deezer-previews.mjs <輸入CSV路徑> [輸出CSV路徑]
 *   node scripts/fetch-deezer-previews.mjs songs.csv songs-deezer-filled.csv
 *   node scripts/fetch-deezer-previews.mjs songs.csv songs-deezer-filled.csv --dry-run
 *   node scripts/fetch-deezer-previews.mjs songs.csv songs-deezer-filled.csv --force
 *
 * 省略輸出路徑時，預設寫回輸入檔案同目錄下、檔名加上 -deezer-filled 後綴。
 *
 * 參數：
 *   --dry-run     只印出會查到什麼，不寫出檔案
 *   --force       已經有 deezerPreviewUrl 的列也重新查一次（用來刷新失效的試聽網址）
 *   --delay=毫秒   每次查詢之間的間隔（預設 2000ms）
 *
 * 完整流程建議：
 * 1. 先跑過 scripts/fetch-apple-previews.mjs，補完能補的 Apple Music 來源
 * 2. 到 /admin「匯出 CSV」，拿到補完 Apple Music 之後的題庫
 * 3. node scripts/fetch-deezer-previews.mjs songs.csv songs-deezer-filled.csv
 * 4. 打開輸出的 CSV，聽過每一列標記為「低信心」的試聽網址，確認是不是同一首歌，
 *    不是的話手動清空那一列的 deezerTrackId／deezerPreviewUrl 或改填正確的
 * 5. 到 /admin「匯入 CSV」，選 songs-deezer-filled.csv 匯入——會依 youtubeVideoId 或
 *    appleMusicPreviewUrl 比對到既有歌曲並更新，不會重複新增
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';

const SEARCH_ENDPOINT = 'https://api.deezer.com/search';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const isDryRun = process.argv.includes('--dry-run');
const isForce = process.argv.includes('--force');
const delayArg = process.argv.find((a) => a.startsWith('--delay='));
const delayMs = delayArg ? Number(delayArg.split('=')[1]) || 2000 : 2000;

const inputPath = args[0];
if (!inputPath) {
  console.error('用法：node scripts/fetch-deezer-previews.mjs <輸入CSV路徑> [輸出CSV路徑]');
  process.exitCode = 1;
  process.exit();
}
const outputPath =
  args[1] ??
  (() => {
    const ext = path.extname(inputPath);
    const base = inputPath.slice(0, -ext.length || undefined);
    return `${base}-deezer-filled${ext || '.csv'}`;
  })();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 簡單的字串相似度比較（正規化後比對是否互相包含），用來判斷 Deezer 回傳的曲目
 * 是不是真的對應到我們要找的歌名／歌手，而不是隨便抓第一筆結果就當作正確答案。
 * 正規化：轉小寫、去除全形/半形空白與標點，避免「(feat. XXX)」「－Live版－」這類
 * 附加資訊讓原本合理的比對被誤判為不像。
 */
function normalize(s) {
  return (s ?? '')
    .toLowerCase()
    .replace(/[\s\u3000\-–—_/／·・()（）\[\]【】.,，。!！?？'"「」]/g, '');
}

function isCloseMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

async function searchDeezerTrack(title, artist) {
  const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(`${title} ${artist}`)}&limit=5`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.warn(`  查詢失敗（網路錯誤）：${err.message}`);
    return null;
  }

  if (res.status === 403 || res.status === 429) {
    // 被限流：等久一點重試一次，只重試一次，避免無窮迴圈卡住整批查詢
    console.warn(`  被限流（HTTP ${res.status}），等待 10 秒後重試一次…`);
    await sleep(10000);
    try {
      res = await fetch(url);
    } catch (err) {
      console.warn(`  重試仍失敗：${err.message}`);
      return null;
    }
  }

  if (!res.ok) {
    console.warn(`  查詢失敗（HTTP ${res.status}）`);
    return null;
  }

  const data = await res.json();

  // Deezer 對查詢頻率過高或參數異常時，回應本身仍是 200 但帶一個 error 物件，不是走 HTTP 錯誤碼
  if (data.error) {
    console.warn(`  Deezer 回傳錯誤內容：${JSON.stringify(data.error)}`);
    return null;
  }

  const results = (data.data ?? []).filter((r) => Boolean(r.preview));
  if (results.length === 0) return null;

  // 優先挑「歌名跟歌手都對得上」的結果；找不到就退回第一筆（相關性最高的），
  // 但標記為低信心，交給人工核對，而不是直接放棄不填。
  const goodMatch = results.find((r) => isCloseMatch(r.title, title) && isCloseMatch(r.artist?.name, artist));
  if (goodMatch) {
    return { track: goodMatch, confidence: 'high' };
  }
  return { track: results[0], confidence: 'low' };
}

async function main() {
  const csvText = await readFile(inputPath, 'utf-8');
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (parsed.errors.length > 0) {
    console.error('CSV 解析錯誤：', parsed.errors[0]);
    process.exitCode = 1;
    return;
  }

  const rows = parsed.data;
  console.log(`讀到 ${rows.length} 列，開始查詢 Deezer 試聽來源…\n`);

  // 「歌名＋歌手」→ 查詢結果 的快取，同一首歌在 CSV 裡因為多個主題分類重複出現時只查一次
  const cache = new Map();
  let queried = 0;
  let filled = 0;
  let lowConfidenceCount = 0;
  let skipped = 0;
  let notFound = 0;
  const lowConfidenceRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const title = (row.title ?? '').trim();
    const artist = (row.artist ?? '').trim();
    if (!title || !artist) continue;

    const hasExisting = (row.deezerPreviewUrl ?? '').trim().length > 0;
    if (hasExisting && !isForce) {
      skipped++;
      continue;
    }

    const cacheKey = `${title.toLowerCase()}|||${artist.toLowerCase()}`;
    let result;
    if (cache.has(cacheKey)) {
      result = cache.get(cacheKey);
    } else {
      queried++;
      process.stdout.write(`[${i + 2}] 查詢「${title}」－${artist} … `);
      result = await searchDeezerTrack(title, artist);
      cache.set(cacheKey, result);
      await sleep(delayMs);
    }

    if (!result) {
      console.log('找不到符合的曲目');
      notFound++;
      continue;
    }

    const { track, confidence } = result;
    row.deezerTrackId = String(track.id ?? '');
    row.deezerPreviewUrl = track.preview ?? '';
    filled++;

    const matchedArtistName = track.artist?.name ?? '';
    if (confidence === 'low') {
      lowConfidenceCount++;
      lowConfidenceRows.push({ row: i + 2, title, artist, matchedTitle: track.title, matchedArtist: matchedArtistName });
      console.log(`⚠️ 低信心比對：找到「${track.title}」－${matchedArtistName}（請人工核對是否為同一首歌）`);
    } else {
      console.log(`✓ 「${track.title}」－${matchedArtistName}`);
    }
  }

  console.log(`\n查詢完成：實際查詢 ${queried} 次`);
  console.log(`補上試聽來源 ${filled} 列，其中低信心比對 ${lowConfidenceCount} 列，找不到 ${notFound} 列，略過（已有資料）${skipped} 列`);

  if (lowConfidenceRows.length > 0) {
    console.log('\n以下列的比對信心較低，匯入前請務必打開試聽網址核對是否為同一首歌：');
    for (const r of lowConfidenceRows) {
      console.log(`  第 ${r.row} 列：CSV 寫的是「${r.title}」－${r.artist}，比對到「${r.matchedTitle}」－${r.matchedArtist}`);
    }
  }

  if (isDryRun) {
    console.log('\n--dry-run 模式，不寫出檔案。');
    return;
  }

  const outputCsv = Papa.unparse(rows, { columns: parsed.meta.fields });
  await writeFile(outputPath, '\uFEFF' + outputCsv, 'utf-8');
  console.log(`\n已寫出：${outputPath}`);
  console.log('下一步：打開這份 CSV 核對低信心比對的列，確認沒問題後到 /admin「匯入 CSV」匯入。');
}

main().catch((err) => {
  console.error('腳本執行失敗：', err);
  process.exitCode = 1;
});
