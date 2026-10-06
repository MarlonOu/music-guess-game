import { prisma } from '../db';

/**
 * 解析一首歌的封面圖網址。優先序：Apple Music 專輯封面 → Deezer 專輯封面 → YouTube 縮圖。
 * 官方專輯封面是正方形、解析度高，YouTube 縮圖是 4:3 帶黑邊的影片截圖，只當最後退路。
 * 結果（包含「查不到」）依歌曲 id 快取在伺服器記憶體，同一首歌不會重複打外部 API。
 */
const cache = new Map<string, { url: string | null; at: number }>();
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function appleCover(trackId: string): Promise<string | null> {
  const data = (await fetchJson(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&country=TW`
  )) as { results?: { artworkUrl100?: string }[] } | null;
  const art = data?.results?.[0]?.artworkUrl100;
  // 預設 100x100，網址裡的尺寸可以直接換成較大的版本
  return art ? art.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null;
}

async function deezerCover(trackId: string): Promise<string | null> {
  const data = (await fetchJson(`https://api.deezer.com/track/${encodeURIComponent(trackId)}`)) as {
    album?: { cover_big?: string; cover_medium?: string };
  } | null;
  return data?.album?.cover_big ?? data?.album?.cover_medium ?? null;
}

const inflight = new Map<string, Promise<string | null>>();

function freshCache(songId: string) {
  const hit = cache.get(songId);
  return hit && Date.now() - hit.at < (hit.url ? FOUND_TTL_MS : MISS_TTL_MS) ? hit : null;
}

/**
 * 不阻塞的版本：有快取就直接回傳，沒有就在背景開始查詢並先回 null。
 * 房間狀態每 600ms 被所有玩家輪詢一次，不能讓外部 API 的延遲拖慢輪詢回應；
 * 題目開始時就先呼叫一次暖機，等公布答案時通常已經有結果。
 */
export function peekSongCoverUrl(songId: string): string | null {
  const hit = freshCache(songId);
  if (hit) return hit.url;
  void resolveSongCoverUrl(songId).catch(() => {});
  return null;
}

export function resolveSongCoverUrl(songId: string): Promise<string | null> {
  const hit = freshCache(songId);
  if (hit) return Promise.resolve(hit.url);
  const pending = inflight.get(songId);
  if (pending) return pending;
  const p = lookupCover(songId).finally(() => inflight.delete(songId));
  inflight.set(songId, p);
  return p;
}

async function lookupCover(songId: string): Promise<string | null> {

  const song = await prisma.song.findUnique({
    where: { id: songId },
    select: { appleMusicTrackId: true, deezerTrackId: true, youtubeVideoId: true },
  });
  if (!song) return null;

  let url: string | null = null;
  if (song.appleMusicTrackId) url = await appleCover(song.appleMusicTrackId);
  if (!url && song.deezerTrackId) url = await deezerCover(song.deezerTrackId);
  if (!url && song.youtubeVideoId) url = `https://i.ytimg.com/vi/${song.youtubeVideoId}/hqdefault.jpg`;

  cache.set(songId, { url, at: Date.now() });
  return url;
}
