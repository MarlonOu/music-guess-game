import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 伺服器端音訊裁切：把 Apple／Deezer 官方試聽片段下載後，只截出「目前解鎖的那一段」再回傳。
 *
 * 目的是讓「可以聽多久」由伺服器決定，而不是靠客戶端自己遵守。客戶端拿到的音訊檔本身
 * 就只有解鎖的長度，改前端程式碼也無法多聽；原始試聽網址（含曲目代號）也不會暴露給客戶端。
 *
 * 需要 ffmpeg：優先用內附的 @ffmpeg-installer/ffmpeg，其次環境變數 FFMPEG_PATH，最後系統 PATH。
 * 找不到或裁切失敗時回傳 null，呼叫端應回報錯誤讓客戶端改用下一個來源。
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 15000;
const CACHE_LIMIT = 60;

let ffmpegPathPromise: Promise<string> | null = null;

function resolveFfmpegPath(): Promise<string> {
  ffmpegPathPromise ??= (async () => {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    try {
      const mod = (await import('@ffmpeg-installer/ffmpeg')) as { path?: string; default?: { path?: string } };
      const p = mod.path ?? mod.default?.path;
      if (p) return p;
    } catch {
      // 套件不存在就退回系統 ffmpeg
    }
    return 'ffmpeg';
  })();
  return ffmpegPathPromise;
}

const cache = new Map<string, Buffer>();

async function downloadPreview(url: string): Promise<Buffer | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_PREVIEW_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(handle);
  }
}

function runFfmpeg(bin: string, inputFile: string, startSec: number, durationSec: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      ['-v', 'error', '-ss', String(startSec), '-t', String(durationSec), '-i', inputFile, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT_MS);
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      resolve(code === 0 && out.length > 1024 ? out : null);
    });
  });
}

/** 取得試聽片段中 [startSec, startSec + durationSec) 的 mp3。cacheKey 相同時直接回傳快取。 */
export async function clipPreview(
  cacheKey: string,
  url: string,
  startSec: number,
  durationSec: number
): Promise<Buffer | null> {
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const source = await downloadPreview(url);
  if (!source) return null;

  const tmp = path.join(os.tmpdir(), `mgg-preview-${randomUUID()}`);
  try {
    await fs.writeFile(tmp, source);
    const out = await runFfmpeg(await resolveFfmpegPath(), tmp, startSec, durationSec);
    if (!out) return null;
    cache.set(cacheKey, out);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return out;
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}
