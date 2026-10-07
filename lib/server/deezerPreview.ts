/**
 * Deezer 試聽網址的「播放時才解析」機制。
 *
 * Deezer 的試聽網址（cdnt-preview.dzcdn.net/...）帶有時效簽章，過一陣子就會失效，資料庫裡存的網址
 * 會變成無法播放，定期（每週）刷新也追不上過期速度。所以播放時不使用存好的網址，改成：
 * 客戶端／伺服器拿到的是一個穩定的站內路徑 /api/audio/deezer/<token>，請求時由伺服器用 track id
 * 向 Deezer 查詢「當下有效」的網址（短時間內記憶體快取，同一首歌不會重複查），再轉址過去。
 *
 * token 是加密過的 track id，不是明碼：測驗模式的題目要隱藏歌曲身分，Deezer track id 本身可以
 * 直接查到歌名，明碼放在網址裡等於把答案給客戶端。加密為「合成 IV」模式（IV 由 HMAC 決定），
 * 同一個 id 永遠產生同一個 token（瀏覽器可快取），解密後還會驗證 HMAC，竄改過的 token 一律拒絕。
 * 金鑰取自 AUDIO_TOKEN_SECRET，未設定時退回 ADMIN_PASSWORD／DATABASE_URL（皆為伺服器私有設定）。
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';

const TRACK_API = 'https://api.deezer.com/track';
const CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const CACHE_LIMIT = 2000;

function secretKey(): Buffer {
  const secret = process.env.AUDIO_TOKEN_SECRET || process.env.ADMIN_PASSWORD || process.env.DATABASE_URL || 'music-guess-game';
  return createHash('sha256').update(secret).digest();
}

function syntheticIv(key: Buffer, id: string): Buffer {
  return createHmac('sha256', key).update(`iv:${id}`).digest().subarray(0, 16);
}

export function sealDeezerTrackId(trackId: string): string {
  const key = secretKey();
  const iv = syntheticIv(key, trackId);
  const cipher = createCipheriv('aes-256-ctr', key, iv);
  const ct = Buffer.concat([cipher.update(trackId, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ct]).toString('base64url');
}

export function unsealDeezerTrackId(token: string): string | null {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length <= 16 || buf.length > 64) return null;
    const key = secretKey();
    const iv = buf.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-ctr', key, iv);
    const id = Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]).toString('utf8');
    if (!/^\d{1,15}$/.test(id)) return null;
    const expected = syntheticIv(key, id);
    return expected.length === iv.length && timingSafeEqual(expected, iv) ? id : null;
  } catch {
    return null;
  }
}

/** 站內穩定的 Deezer 播放路徑；沒有 track id 的歌曲回傳 null（呼叫端改用資料庫存的網址） */
export function deezerPlayPath(trackId: string | null | undefined): string | null {
  if (!trackId || !/^\d{1,15}$/.test(trackId)) return null;
  return `/api/audio/deezer/${sealDeezerTrackId(trackId)}`;
}

const globalForCache = globalThis as unknown as {
  __deezerPreviewCache?: Map<string, { url: string | null; at: number }>;
  __deezerPreviewInflight?: Map<string, Promise<string | null>>;
};
const cache = (globalForCache.__deezerPreviewCache ??= new Map());
const inflight = (globalForCache.__deezerPreviewInflight ??= new Map());

async function fetchPreview(trackId: string): Promise<string | null> {
  try {
    const res = await fetch(`${TRACK_API}/${trackId}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as { preview?: string; error?: unknown };
    // 查無此 id 或頻率過高時 Deezer 仍回 200，但帶 error 物件
    if (data.error || !data.preview) return null;
    return data.preview;
  } catch {
    return null;
  }
}

/** 取得這首 Deezer 曲目「目前有效」的試聽網址；查不到回傳 null。同時間同一 id 只會發一次請求。 */
export async function resolveDeezerPreview(trackId: string): Promise<string | null> {
  const hit = cache.get(trackId);
  if (hit && Date.now() - hit.at < (hit.url ? CACHE_TTL_MS : NEGATIVE_TTL_MS)) return hit.url;
  const pending = inflight.get(trackId);
  if (pending) return pending;
  const task = fetchPreview(trackId)
    .then((url) => {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(trackId, { url, at: Date.now() });
      return url;
    })
    .finally(() => inflight.delete(trackId));
  inflight.set(trackId, task);
  return task;
}
