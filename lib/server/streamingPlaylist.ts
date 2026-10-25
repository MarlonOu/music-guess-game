/**
 * 讀取串流平台（KKBOX、Spotify）公開歌單的歌名與歌手，供管理頁「從串流平台歌單匯入」使用。
 *
 * - KKBOX：官方 Open API（需要 KKBOX_CLIENT_ID／KKBOX_CLIENT_SECRET，Client Credentials 流程），
 *   讀取公開的分享歌單 /v1.1/shared-playlists/{id}。
 * - Spotify：Web API 自 2026/02 起，開發模式的應用程式只能讀取「自己擁有或協作」的歌單內容，
 *   一般公開歌單拿不到曲目，因此改讀公開的嵌入頁（open.spotify.com/embed/playlist/{id}）內附的歌單資料，
 *   不需要金鑰；單次最多約 100 首。
 *
 * 只讀取「歌名＋歌手＋封面」，不下載任何音訊；所有網址的主機名稱都是固定的，使用者輸入只會用來取出歌單 ID。
 */

export type StreamingPlatform = 'kkbox' | 'spotify';

export interface StreamingTrack {
  title: string;
  /** 預設歌手：Spotify 多位歌手時只取第一位（其餘放在 artistsAll） */
  artist: string;
  /** 平台上完整的歌手字串（多位歌手時用於提示），與 artist 相同時為空 */
  artistsAll: string;
  coverUrl: string;
}

export interface StreamingPlaylist {
  platform: StreamingPlatform;
  playlistId: string;
  name: string;
  tracks: StreamingTrack[];
  /** 平台回報的總曲數大於實際取得的曲數 */
  truncated: boolean;
}

export class StreamingPlaylistError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export const MAX_TRACKS = 300;
const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------------------------------------------------------------- 網址解析

/** 從 KKBOX 歌單網址（或裸 ID）取出歌單 ID。例：https://www.kkbox.com/tw/tc/playlist/OsGyaNJ6RAlnBvbIhS */
export function parseKkboxPlaylistId(input: string): string | null {
  const text = input.trim();
  const m = /kkbox\.com\/(?:[^?#]*\/)?playlist\/([A-Za-z0-9_-]{8,})/i.exec(text);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(text)) return text;
  return null;
}

/** 從 Spotify 歌單網址、URI（spotify:playlist:ID）或裸 ID 取出歌單 ID（22 碼 base62） */
export function parseSpotifyPlaylistId(input: string): string | null {
  const text = input.trim();
  const url = /open\.spotify\.com\/(?:[^?#]*\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{22})/i.exec(text);
  if (url) return url[1];
  const uri = /^spotify:playlist:([A-Za-z0-9]{22})$/i.exec(text);
  if (uri) return uri[1];
  if (/^[A-Za-z0-9]{22}$/.test(text)) return text;
  return null;
}

// ---------------------------------------------------------------- 共用

function clean(v: unknown, max = 200): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[  -​  　]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new StreamingPlaylistError('連線逾時或失敗，請稍後再試', 502);
  }
}

// ---------------------------------------------------------------- KKBOX

const KKBOX_API = 'https://api.kkbox.com/v1.1';
const KKBOX_TOKEN_URL = 'https://account.kkbox.com/oauth2/token';
const KKBOX_TERRITORY = 'TW';

let kkboxToken: { value: string; expiresAt: number } | null = null;

async function getKkboxToken(): Promise<string> {
  const id = process.env.KKBOX_CLIENT_ID;
  const secret = process.env.KKBOX_CLIENT_SECRET;
  if (!id || !secret) {
    throw new StreamingPlaylistError('伺服器未設定 KKBOX_CLIENT_ID／KKBOX_CLIENT_SECRET，請參考 .env.example 設定後重啟伺服器', 500);
  }
  if (kkboxToken && kkboxToken.expiresAt > Date.now() + 60_000) return kkboxToken.value;
  const res = await fetchWithTimeout(KKBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  });
  if (!res.ok) {
    throw new StreamingPlaylistError(`KKBOX 授權失敗（HTTP ${res.status}），請確認 KKBOX_CLIENT_ID／KKBOX_CLIENT_SECRET 是否正確`, 502);
  }
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new StreamingPlaylistError('KKBOX 授權回應格式不正確', 502);
  kkboxToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

interface KkboxTracksPage {
  data?: unknown;
  paging?: { next?: unknown };
  summary?: { total?: unknown };
}

/** 把 KKBOX 的曲目陣列轉成統一格式（純函式，供測試） */
export function parseKkboxTracks(data: unknown): StreamingTrack[] {
  if (!Array.isArray(data)) return [];
  const out: StreamingTrack[] = [];
  for (const t of data) {
    const track = t as { name?: unknown; album?: { images?: { url?: unknown }[]; artist?: { name?: unknown } } };
    const title = clean(track?.name);
    const artist = clean(track?.album?.artist?.name, 100);
    if (!title) continue;
    const cover = track.album?.images?.find((i) => typeof i?.url === 'string')?.url;
    out.push({ title, artist, artistsAll: '', coverUrl: typeof cover === 'string' && cover.startsWith('https://') ? cover : '' });
  }
  return out;
}

async function kkboxGet(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) throw new StreamingPlaylistError('找不到這個 KKBOX 歌單，請確認網址是否正確、歌單是否公開', 404);
  if (!res.ok) throw new StreamingPlaylistError(`KKBOX API 回應錯誤（HTTP ${res.status}）`, 502);
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function fetchKkboxPlaylist(playlistId: string): Promise<StreamingPlaylist> {
  const token = await getKkboxToken();
  const base = await kkboxGet(`${KKBOX_API}/shared-playlists/${encodeURIComponent(playlistId)}?territory=${KKBOX_TERRITORY}`, token);
  const first = (base.tracks ?? {}) as KkboxTracksPage;
  const tracks = parseKkboxTracks(first.data);
  let next = typeof first.paging?.next === 'string' ? first.paging.next : '';
  const total = typeof first.summary?.total === 'number' ? first.summary.total : tracks.length;

  // 後續分頁只跟隨官方 API 網域的網址，避免被回應內容導向其他主機
  while (next && tracks.length < MAX_TRACKS) {
    let nextUrl: URL;
    try {
      nextUrl = new URL(next);
    } catch {
      break;
    }
    if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== 'api.kkbox.com') break;
    const page = (await kkboxGet(nextUrl.toString(), token)) as KkboxTracksPage;
    tracks.push(...parseKkboxTracks(page.data));
    next = typeof page.paging?.next === 'string' ? page.paging.next : '';
  }

  const limited = tracks.slice(0, MAX_TRACKS);
  return {
    platform: 'kkbox',
    playlistId,
    name: clean(base.title, 100),
    tracks: limited,
    truncated: total > limited.length,
  };
}

// ---------------------------------------------------------------- Spotify

/** 在任意 JSON 結構中找出第一個名為 key、且為陣列的屬性（嵌入頁的資料層級偶爾會調整，不寫死路徑） */
function findArray(node: unknown, key: string, depth = 0): unknown[] | null {
  if (depth > 12 || node === null || typeof node !== 'object') return null;
  if (!Array.isArray(node)) {
    const direct = (node as Record<string, unknown>)[key];
    if (Array.isArray(direct)) return direct;
  }
  const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
  for (const child of children) {
    const hit = findArray(child, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** 從 Spotify 嵌入頁 HTML 取出歌單名稱與曲目（純函式，供測試） */
export function parseSpotifyEmbed(html: string): { name: string; tracks: StreamingTrack[] } | null {
  const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  let json: unknown;
  try {
    json = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const list = findArray(json, 'trackList');
  if (!list) return null;
  const tracks: StreamingTrack[] = [];
  for (const t of list) {
    const item = t as { title?: unknown; subtitle?: unknown };
    const title = clean(item?.title);
    const all = clean(item?.subtitle, 200);
    if (!title) continue;
    // 多位歌手以逗號分隔（Spotify 會用「, 」或全形逗號）；預設只取第一位當歌手
    const first = all.split(/\s*[,，]\s*/)[0] ?? all;
    tracks.push({ title, artist: first, artistsAll: first === all ? '' : all, coverUrl: '' });
  }
  const root = json as { props?: { pageProps?: { state?: { data?: { entity?: { name?: unknown; title?: unknown } } } } } };
  const entity = root.props?.pageProps?.state?.data?.entity;
  const name = clean(entity?.name ?? entity?.title, 100);
  return { name, tracks };
}

export async function fetchSpotifyPlaylist(playlistId: string): Promise<StreamingPlaylist> {
  const res = await fetchWithTimeout(`https://open.spotify.com/embed/playlist/${encodeURIComponent(playlistId)}`, {
    headers: { 'user-agent': BROWSER_UA, 'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8', accept: 'text/html' },
  });
  if (res.status === 404) throw new StreamingPlaylistError('找不到這個 Spotify 歌單，請確認網址是否正確、歌單是否公開', 404);
  if (!res.ok) throw new StreamingPlaylistError(`Spotify 回應錯誤（HTTP ${res.status}）`, 502);
  const parsed = parseSpotifyEmbed(await res.text());
  if (!parsed) {
    throw new StreamingPlaylistError('無法解析 Spotify 歌單內容（Spotify 可能調整了嵌入頁格式，或這個歌單不開放嵌入）', 502);
  }
  const tracks = parsed.tracks.slice(0, MAX_TRACKS);
  return {
    platform: 'spotify',
    playlistId,
    name: parsed.name,
    tracks,
    // 嵌入頁固定只提供前約 100 首；達到 100 首時提示可能還有更多
    truncated: tracks.length >= 100,
  };
}

export async function fetchStreamingPlaylist(platform: StreamingPlatform, input: string): Promise<StreamingPlaylist> {
  if (platform === 'kkbox') {
    const id = parseKkboxPlaylistId(input);
    if (!id) throw new StreamingPlaylistError('無法識別這個 KKBOX 歌單網址，請貼上歌單分享網址', 400);
    return fetchKkboxPlaylist(id);
  }
  const id = parseSpotifyPlaylistId(input);
  if (!id) throw new StreamingPlaylistError('無法識別這個 Spotify 歌單網址，請貼上歌單分享網址（open.spotify.com/playlist/…）', 400);
  return fetchSpotifyPlaylist(id);
}
