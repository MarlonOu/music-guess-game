#!/usr/bin/env -S npx tsx
/**
 * 自動、安全地刷新所有「已經有 track id」的 Apple Music／Deezer 試聽網址——
 * 專門給排程（cron）無人值守執行用，直接讀寫資料庫，不透過 CSV 匯出匯入。
 *
 * 安全原則：只做「用已知 id 直接查詢最新網址」這一種操作（見
 * scripts/fetch-apple-previews.mjs、scripts/fetch-deezer-previews.mjs 裡
 * lookupAppleTrackById／lookupDeezerTrackById 的完整說明），絕對不會對任何歌曲做
 * 「用歌名＋歌手重新搜尋比對」這件事——這個腳本的存在前提就是排程、無人值守執行，
 * 任何可能選錯歌曲的操作都不該在無人監督的情況下自動發生，只有 100% 安全、
 * 不涉及任何比對判斷的「同一首歌換新網址」才適合排程自動化。appleMusicVerified／
 * deezerVerified 這兩個標記對這支腳本來說其實沒有影響——反正這裡本來就不會做任何
 * 需要這兩個標記來防呆的「重新搜尋」動作。
 *
 * 找不到既有 track id 的歌曲（沒有 trackId），或曾經的 trackId 現在查不到了（可能已經
 * 從該平台下架），一律跳過、只在摘要跟 removedTrackIds 裡列出來，交由管理者有空的時候
 * 自己到 /admin 或用 fetch-apple-previews.mjs／fetch-deezer-previews.mjs 手動處理
 * （也包含決定要不要把該筆標記為 appleMusicSkip／deezerSkip）——這支腳本本身絕對不會
 * 自動清空或動到任何現有欄位，查不到就是維持原狀、留給人工判斷。
 *
 * 使用方式（給 cron／systemd timer 用）：
 *   cd /path/to/music-guess-game && npx tsx scripts/auto-refresh-previews.ts
 * 也可以手動執行確認效果，不會對資料庫做任何「比對」風險的操作，隨時執行都安全。
 *
 * 環境變數：讀取 DATABASE_URL，透過 lib/db.ts 共用同一個 Prisma 連線設定；
 * cron 底下沒有 shell 的互動環境，不會自動載入 .env，所以這裡手動讀取一次
 * （見下方 loadDotEnv，純粹解析 KEY=VALUE，沒有額外套件相依）。
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function loadDotEnv(): void {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const APPLE_LOOKUP_ENDPOINT = 'https://itunes.apple.com/lookup';
const DEEZER_TRACK_ENDPOINT = 'https://api.deezer.com/track';
const APPLE_COUNTRY = process.env.AUTO_REFRESH_APPLE_COUNTRY ?? 'TW';
// 兩邊 API 都建議每分鐘不超過 20 次請求左右（見兩支 fetch-*-previews.mjs 腳本開頭的說明），
// 這裡用 3.5 秒間隔，比單獨跑其中一個平台時更保守一點，因為這支腳本會接續著把兩個平台
// 都刷新完，兩邊總請求數加起來更多。
const DELAY_MS = 3500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RefreshResult {
  refreshed: number;
  removed: Array<{ id: string; title: string; trackId: string }>;
}

// 只用型別 import（不會有任何執行期副作用，純粹拿型別定義），讓下面兩個函式可以正確標註
// prisma 參數的型別，同時避免在檔案最上層就真的執行 lib/db.ts 的連線建立邏輯——
// 真正的連線要等 main() 裡、loadDotEnv() 確定執行完之後才動態 import 進來。
type PrismaClientType = typeof import('../lib/db').prisma;

export async function refreshAppleUrls(prisma: PrismaClientType): Promise<RefreshResult> {
  const songs = await prisma.song.findMany({
    where: { appleMusicTrackId: { not: null } },
    select: { id: true, title: true, appleMusicTrackId: true },
  });

  let refreshed = 0;
  const removed: RefreshResult['removed'] = [];

  for (const song of songs) {
    const trackId = song.appleMusicTrackId;
    if (!trackId) continue;

    const url = `${APPLE_LOOKUP_ENDPOINT}?id=${encodeURIComponent(trackId)}&country=${encodeURIComponent(APPLE_COUNTRY)}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      console.warn(`  [Apple] 「${song.title}」查詢失敗（網路錯誤）：${(err as Error).message}`);
      await sleep(DELAY_MS);
      continue;
    }

    if (res.status === 403 || res.status === 429) {
      console.warn(`  [Apple] 被限流（HTTP ${res.status}），等待 10 秒後重試一次…`);
      await sleep(10000);
      try {
        res = await fetch(url);
      } catch (err) {
        console.warn(`  [Apple] 重試仍失敗：${(err as Error).message}`);
        await sleep(DELAY_MS);
        continue;
      }
    }

    if (!res.ok) {
      console.warn(`  [Apple] 「${song.title}」查詢失敗（HTTP ${res.status}）`);
      await sleep(DELAY_MS);
      continue;
    }

    const data = await res.json();
    const track = (data.results ?? [])[0];
    if (!track || !track.previewUrl) {
      removed.push({ id: song.id, title: song.title, trackId });
      await sleep(DELAY_MS);
      continue;
    }

    await prisma.song.update({
      where: { id: song.id },
      data: { appleMusicPreviewUrl: track.previewUrl },
    });
    refreshed++;
    await sleep(DELAY_MS);
  }

  return { refreshed, removed };
}

export async function refreshDeezerUrls(prisma: PrismaClientType): Promise<RefreshResult> {
  const songs = await prisma.song.findMany({
    where: { deezerTrackId: { not: null } },
    select: { id: true, title: true, deezerTrackId: true },
  });

  let refreshed = 0;
  const removed: RefreshResult['removed'] = [];

  for (const song of songs) {
    const trackId = song.deezerTrackId;
    if (!trackId) continue;

    const url = `${DEEZER_TRACK_ENDPOINT}/${encodeURIComponent(trackId)}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      console.warn(`  [Deezer] 「${song.title}」查詢失敗（網路錯誤）：${(err as Error).message}`);
      await sleep(DELAY_MS);
      continue;
    }

    if (res.status === 403 || res.status === 429) {
      console.warn(`  [Deezer] 被限流（HTTP ${res.status}），等待 10 秒後重試一次…`);
      await sleep(10000);
      try {
        res = await fetch(url);
      } catch (err) {
        console.warn(`  [Deezer] 重試仍失敗：${(err as Error).message}`);
        await sleep(DELAY_MS);
        continue;
      }
    }

    if (!res.ok) {
      console.warn(`  [Deezer] 「${song.title}」查詢失敗（HTTP ${res.status}）`);
      await sleep(DELAY_MS);
      continue;
    }

    const data = await res.json();
    if (data.error || !data.preview) {
      removed.push({ id: song.id, title: song.title, trackId });
      await sleep(DELAY_MS);
      continue;
    }

    await prisma.song.update({
      where: { id: song.id },
      data: { deezerPreviewUrl: data.preview },
    });
    refreshed++;
    await sleep(DELAY_MS);
  }

  return { refreshed, removed };
}

async function main(): Promise<void> {
  // 動態 import，確保是在 loadDotEnv() 真正把 DATABASE_URL 放進 process.env 之後，
  // lib/db.ts 建立連線 adapter 時才讀得到——靜態 import 會在檔案最上面就先執行，
  // 那時候 .env 可能還沒載入。放在 main() 裡面（而不是檔案最上層）用一般的 await，
  // 也是為了避免在某些執行環境（例如透過別的腳本動態 import 這支檔案做測試）對
  // 頂層 await 的支援度不一致而出錯。
  const { prisma } = await import('../lib/db');

  const startedAt = new Date();
  console.log(`[${startedAt.toISOString()}] 開始自動刷新試聽網址…`);

  console.log('\n=== Apple Music ===');
  const apple = await refreshAppleUrls(prisma);
  console.log(`刷新 ${apple.refreshed} 首，${apple.removed.length} 首查不到既有 id 了（可能已下架，維持原狀，未自動清空）`);
  for (const r of apple.removed) {
    console.log(`  ⚠ 「${r.title}」（id: ${r.trackId}）建議人工確認：到 /admin 核對，必要時手動清空或勾選「已確認找不到」`);
  }

  console.log('\n=== Deezer ===');
  const deezer = await refreshDeezerUrls(prisma);
  console.log(`刷新 ${deezer.refreshed} 首，${deezer.removed.length} 首查不到既有 id 了（可能已下架，維持原狀，未自動清空）`);
  for (const r of deezer.removed) {
    console.log(`  ⚠ 「${r.title}」（id: ${r.trackId}）建議人工確認：到 /admin 核對，必要時手動清空或勾選「已確認找不到」`);
  }

  const elapsedSec = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(`\n完成，耗時 ${elapsedSec} 秒。總計刷新 ${apple.refreshed + deezer.refreshed} 首，` +
    `${apple.removed.length + deezer.removed.length} 首需要人工確認。`);

  await prisma.$disconnect();
}

// 只有在「直接執行這支檔案」時才自動跑 main()——如果是被別的檔案 import（例如單元測試
// 只想用 refreshAppleUrls／refreshDeezerUrls 這兩個函式本身，不想真的連線跑一次），
// 不應該連帶觸發整個流程跑起來。
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error('自動刷新發生未預期的錯誤：', err);
    // 這裡不特別呼叫 prisma.$disconnect()——發生例外的時候 prisma 不一定已經成功初始化
    // （例如 DATABASE_URL 根本沒設好），而且行程本來就要結束了，連線會隨行程結束自然釋放。
    process.exitCode = 1;
  });
}
