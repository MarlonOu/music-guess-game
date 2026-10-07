import type { NextRequest } from 'next/server';

/**
 * 極簡的記憶體內固定視窗頻率限制，用來擋住「用腳本狂刷開始挑戰／送出成績」這類濫用。
 * 狀態存在伺服器記憶體（與 speedrunSession／streakSession 相同的取捨：單一 process、
 * 重啟後歸零，對這個規模的站台已足夠）。以 globalThis 保存，避免各 route bundle 各自
 * 持有一份獨立的計數而失效。
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const globalForLimit = globalThis as unknown as { __rateBuckets?: Map<string, Bucket> };
const buckets = (globalForLimit.__rateBuckets ??= new Map<string, Bucket>());

/** 取得請求來源 IP：站台在 Cloudflare Tunnel 後面，優先採用 Cloudflare 帶入的標頭。 */
export function getClientIp(request: NextRequest): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

/**
 * 在 windowMs 內同一個 key 最多允許 limit 次。回傳 true 代表放行，false 代表超過限制。
 */
export function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
