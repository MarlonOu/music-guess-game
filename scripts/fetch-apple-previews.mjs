#!/usr/bin/env node
/**
 * 讀取一份歌曲 CSV（格式對應 /admin 頁面「匯出 CSV」/「匯入 CSV」的標準格式，
 * 見 lib/csv/songCsv.ts：title,artist,youtubeVideoId,appleMusicTrackId,appleMusicPreviewUrl,
 * appleMusicSkip,deezerTrackId,deezerPreviewUrl,deezerSkip,durationSec,themes,lyrics），
 * 對每一列 appleMusicPreviewUrl 空白的資料，用 title + artist 呼叫 iTunes Search API
 * 查詢最相關的曲目，補回 appleMusicTrackId／appleMusicPreviewUrl 兩個欄位，輸出成一份新的 CSV。
 *
 * appleMusicSkip 是「true」的列一律跳過，不會查詢——這欄位代表管理者已經在 /admin 後台
 * 人工確認過「這首歌在 Apple Music 上真的找不到（或找到的都是錯誤/翻唱版）」，
 * 刻意把試聽網址留空。沒有這個標記的話，appleMusicPreviewUrl 留空這件事沒辦法分辨
 * 「還沒查過」跟「查過了、確認沒有、管理者刻意留空」，重新跑一次這支腳本就會把管理者
 * 刻意清空的欄位又填回類似但錯誤的比對結果，把人工核對過的決定覆蓋掉。
 *
 * 同一個「歌名＋歌手」只會查一次（即使 CSV 裡因為多個主題分類重複出現很多列），
 * 查到的結果會套用到所有相同歌名＋歌手的列，避免浪費請求重複查詢同一首歌。
 *
 * ⚠️ 這是自動化查詢，結果務必人工核對：抓到的可能是翻唱版、Live 版、Remix、
 * 精選輯重新收錄版而非原唱正式版本，尤其歌名／歌手比對出來「不夠像」的列，
 * 腳本會特別標記為「低信心」，這些列請務必打開輸出結果聽過試聽再決定要不要留。
 * 如果核對後確認真的沒有，記得回 /admin 後台把該首歌的「已確認 Apple Music 上真的找不到」
 * 勾選起來，下次跑這支腳本才不會又浪費時間去搜尋同一首歌。
 *
 * 不需要申請任何 API 金鑰——iTunes Search API 是公開、免驗證的服務。
 * 官方沒有硬性公告配額上限，但建議的呼叫頻率大約每分鐘 20 次（--delay 預設值已對齊這個節奏），
 * 太密集呼叫可能被暫時限流，被限流時腳本會自動重試一次、等更久再送出。
 *
 * 使用方式：
 *   node scripts/fetch-apple-previews.mjs <輸入CSV路徑> [輸出CSV路徑]
 *   node scripts/fetch-apple-previews.mjs songs.csv songs-filled.csv
 *   node scripts/fetch-apple-previews.mjs songs.csv songs-filled.csv --dry-run
 *   node scripts/fetch-apple-previews.mjs songs.csv songs-filled.csv --force
 *   node scripts/fetch-apple-previews.mjs songs.csv songs-filled.csv --country=TW
 *
 * 省略輸出路徑時，預設寫回輸入檔案同目錄下、檔名加上 -apple-filled 後綴。
 *
 * 參數：
 *   --dry-run     只印出會查到什麼，不寫出檔案
 *   --force       已經有 appleMusicPreviewUrl 的列也重新查一次（用來刷新失效的試聽網址）；
 *                 不會影響 appleMusicSkip=true 的列，那些列一律跳過，除非加 --ignore-skip
 *   --ignore-skip 連 appleMusicSkip=true 的列也重新查一次（例如想每隔一段時間重新確認
 *                 Apple Music 的曲庫是不是新增了之前找不到的歌，預設不會這麼做）
 *   --country=XX  搜尋哪個 Apple 商店地區（預設 TW），國語/台語歌曲用 TW 通常最準，
 *                 西洋/日韓歌曲找不到時可以再用 US/JP 等別的地區試一次
 *   --delay=毫秒   每次查詢之間的間隔（預設 3000ms，約每分鐘 20 次）
 *
 * 完整流程建議：
 * 1. 到 /admin「匯出 CSV」，拿到目前完整題庫
 * 2. node scripts/fetch-apple-previews.mjs songs.csv songs-apple-filled.csv
 * 3. 打開輸出的 CSV，聽過每一列標記為「低信心」的試聽網址，確認是不是同一首歌，
 *    不是的話手動清空那一列的 appleMusicTrackId／appleMusicPreviewUrl 或改填正確的，
 *    確認真的找不到的話，把該列的 appleMusicSkip 填成 true（或回 /admin 後台勾選）
 * 4. 到 /admin「匯入 CSV」，選 songs-apple-filled.csv 匯入——會依 youtubeVideoId
 *    比對到既有歌曲並更新，不會重複新增
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';

const SEARCH_ENDPOINT = 'https://itunes.apple.com/search';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const isDryRun = process.argv.includes('--dry-run');
const isForce = process.argv.includes('--force');
const isIgnoreSkip = process.argv.includes('--ignore-skip');
const countryArg = process.argv.find((a) => a.startsWith('--country='));
const country = countryArg ? countryArg.split('=')[1] : 'TW';
const delayArg = process.argv.find((a) => a.startsWith('--delay='));
const delayMs = delayArg ? Number(delayArg.split('=')[1]) || 3000 : 3000;

const inputPath = args[0];
if (!inputPath) {
  console.error('用法：node scripts/fetch-apple-previews.mjs <輸入CSV路徑> [輸出CSV路徑]');
  process.exitCode = 1;
  process.exit();
}
const outputPath =
  args[1] ??
  (() => {
    const ext = path.extname(inputPath);
    const base = inputPath.slice(0, -ext.length || undefined);
    return `${base}-apple-filled${ext || '.csv'}`;
  })();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 簡單的字串相似度比較（正規化後比對是否互相包含），用來判斷 iTunes 回傳的曲目
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

async function searchAppleTrack(title, artist) {
  const term = `${title} ${artist}`;
  const url = `${SEARCH_ENDPOINT}?term=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}&media=music&entity=song&limit=5`;

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
  const results = data.results ?? [];
  if (results.length === 0) return null;

  // 優先挑「歌名跟歌手都對得上」的結果；找不到就退回第一筆（相關性最高的），
  // 但標記為低信心，交給人工核對，而不是直接放棄不填。
  const goodMatch = results.find((r) => isCloseMatch(r.trackName, title) && isCloseMatch(r.artistName, artist));
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
  console.log(`讀到 ${rows.length} 列，開始查詢 Apple Music 試聽來源（商店地區：${country}）…\n`);

  // 「歌名＋歌手」→ 查詢結果 的快取，同一首歌在 CSV 裡因為多個主題分類重複出現時只查一次
  const cache = new Map();
  let queried = 0;
  let filled = 0;
  let lowConfidenceCount = 0;
  let skipped = 0;
  let skippedByFlag = 0;
  let notFound = 0;
  const lowConfidenceRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const title = (row.title ?? '').trim();
    const artist = (row.artist ?? '').trim();
    if (!title || !artist) continue;

    const isSkipped = (row.appleMusicSkip ?? '').trim().toLowerCase() === 'true';
    if (isSkipped && !isIgnoreSkip) {
      skippedByFlag++;
      continue;
    }

    const hasExisting = (row.appleMusicPreviewUrl ?? '').trim().length > 0;
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
      result = await searchAppleTrack(title, artist);
      cache.set(cacheKey, result);
      await sleep(delayMs);
    }

    if (!result) {
      console.log('找不到符合的曲目');
      notFound++;
      continue;
    }

    const { track, confidence } = result;
    row.appleMusicTrackId = String(track.trackId ?? '');
    row.appleMusicPreviewUrl = track.previewUrl ?? '';
    filled++;

    if (confidence === 'low') {
      lowConfidenceCount++;
      lowConfidenceRows.push({ row: i + 2, title, artist, matchedTitle: track.trackName, matchedArtist: track.artistName });
      console.log(`⚠️ 低信心比對：找到「${track.trackName}」－${track.artistName}（請人工核對是否為同一首歌）`);
    } else {
      console.log(`✓ 「${track.trackName}」－${track.artistName}`);
    }
  }

  console.log(`\n查詢完成：實際查詢 ${queried} 次（快取命中 ${filled - queried >= 0 ? filled - queried : 0} 次）`);
  console.log(
    `補上試聽來源 ${filled} 列，其中低信心比對 ${lowConfidenceCount} 列，找不到 ${notFound} 列，` +
      `略過（已有資料）${skipped} 列，略過（已確認無此來源）${skippedByFlag} 列`
  );

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
