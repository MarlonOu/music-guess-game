/**
 * Apple Music（iTunes）／Deezer 試聽來源比對（管理頁面「批次比對來源」用）。
 *
 * 這是 scripts/fetch-apple-previews.mjs、scripts/fetch-deezer-previews.mjs 的比對邏輯搬到伺服器端，
 * 差別只在「一次處理一首歌」並且不寫入資料庫：由管理頁面逐首呼叫、顯示結果、讓管理者核對後才套用，
 * 自動比對的結果可能是翻唱／Live／重新收錄版，不能無人審核就覆蓋。
 *
 * 兩種模式：
 * - fill：用「歌名＋歌手」搜尋，回傳最佳候選與信心（high／low）。
 * - refresh：已經有 track id 的歌曲，直接用 id 查詢最新試聽網址，完全不重新搜尋比對
 *   （id 鎖定是哪一首，不會選錯；試聽網址的簽章會過期，需要定期換新）。
 *
 * 兩個平台都是公開免金鑰的 API，建議呼叫頻率約每分鐘 20 次，所以這裡在伺服器端統一節流，
 * 不依賴前端自己控制間隔（多個分頁／多次操作也不會超過）。
 */
import { normalizeForMatch } from '../engine/songMatch';

export type SourcePlatform = 'apple' | 'deezer';
export type SourceMode = 'fill' | 'refresh';

export interface SourceQuery {
  platform: SourcePlatform;
  mode: SourceMode;
  title: string;
  artist: string;
  aliases?: string[];
  /** 歌曲目前登記的長度（秒），用來檢查候選版本的長度是否差太多 */
  durationSec?: number;
  /** refresh 模式必填：既有的 track id */
  trackId?: string;
  /** Apple 商店地區，預設 TW */
  country?: string;
}

export interface SourceCandidate {
  trackId: string;
  trackName: string;
  artistName: string;
  previewUrl: string;
  durationSec: number;
}

export type SourceMatchResult =
  | { status: 'found'; confidence: 'high' | 'low'; candidate: SourceCandidate; durationDiffSec: number | null; note?: string }
  | { status: 'refreshed'; candidate: SourceCandidate }
  | { status: 'notfound'; note?: string }
  | { status: 'error'; error: string };

const MIN_INTERVAL_MS: Record<SourcePlatform, number> = { apple: 3000, deezer: 2000 };
const REQUEST_TIMEOUT_MS = 8000;
const RATE_LIMIT_RETRY_MS = 10_000;
/** 候選版本長度與歌曲登記長度差超過這個秒數，信心降為 low（可能是 Live／Remix／精選輯版本） */
const DURATION_MISMATCH_SEC = 15;

interface Gate {
  tail: Promise<void>;
  last: number;
}
const globalForGate = globalThis as unknown as { __sourceMatchGates?: Record<SourcePlatform, Gate> };
const gates = (globalForGate.__sourceMatchGates ??= {
  apple: { tail: Promise.resolve(), last: 0 },
  deezer: { tail: Promise.resolve(), last: 0 },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 同一平台的請求排隊，兩次請求之間至少間隔 intervalMs */
async function throttle(platform: SourcePlatform, intervalMs: number): Promise<void> {
  const gate = gates[platform];
  const turn = gate.tail.then(async () => {
    const wait = intervalMs - (Date.now() - gate.last);
    if (wait > 0) await sleep(wait);
    gate.last = Date.now();
  });
  gate.tail = turn.catch(() => undefined);
  await turn;
}

async function getJson(url: string, platform: SourcePlatform, intervalMs: number): Promise<unknown> {
  await throttle(platform, intervalMs);
  let res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 403 || res.status === 429) {
    // 被限流：等久一點只重試一次，避免卡住整批
    await sleep(RATE_LIMIT_RETRY_MS);
    await throttle(platform, intervalMs);
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function isClose(a: string, b: string): boolean {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

function pickBest(candidates: SourceCandidate[], q: SourceQuery): SourceCandidate | undefined {
  const titles = [q.title, ...(q.aliases ?? [])];
  return candidates.find((c) => titles.some((t) => isClose(c.trackName, t)) && isClose(c.artistName, q.artist));
}

// ---------------------------------------------------------------- Apple

interface ItunesTrack {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
}

function toAppleCandidate(r: ItunesTrack): SourceCandidate | null {
  if (!r.previewUrl || r.trackId === undefined) return null;
  return {
    trackId: String(r.trackId),
    trackName: r.trackName ?? '',
    artistName: r.artistName ?? '',
    previewUrl: r.previewUrl,
    durationSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
  };
}

async function appleSearch(term: string, limit: number, country: string, intervalMs: number): Promise<SourceCandidate[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}&media=music&entity=song&limit=${limit}`;
  const data = (await getJson(url, 'apple', intervalMs)) as { results?: ItunesTrack[] };
  return (data.results ?? []).map(toAppleCandidate).filter((c): c is SourceCandidate => c !== null);
}

async function appleLookup(trackId: string, country: string, intervalMs: number): Promise<SourceCandidate | null> {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&country=${encodeURIComponent(country)}`;
  const data = (await getJson(url, 'apple', intervalMs)) as { results?: ItunesTrack[] };
  const first = (data.results ?? [])[0];
  return first ? toAppleCandidate(first) : null;
}

// ---------------------------------------------------------------- Deezer

interface DeezerTrack {
  id?: number;
  title?: string;
  artist?: { name?: string };
  preview?: string;
  duration?: number;
}

function toDeezerCandidate(r: DeezerTrack): SourceCandidate | null {
  if (!r.preview || r.id === undefined) return null;
  return {
    trackId: String(r.id),
    trackName: r.title ?? '',
    artistName: r.artist?.name ?? '',
    previewUrl: r.preview,
    durationSec: r.duration ?? 0,
  };
}

async function deezerSearch(q: string, limit: number, intervalMs: number): Promise<SourceCandidate[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  const data = (await getJson(url, 'deezer', intervalMs)) as { data?: DeezerTrack[]; error?: unknown };
  // Deezer 頻率過高或參數異常時回 200 但帶 error 物件，不能當成「查無結果」
  if (data.error) throw new Error('Deezer 回傳錯誤內容（可能是請求過於頻繁）');
  return (data.data ?? []).map(toDeezerCandidate).filter((c): c is SourceCandidate => c !== null);
}

async function deezerLookup(trackId: string, intervalMs: number): Promise<SourceCandidate | null> {
  const url = `https://api.deezer.com/track/${encodeURIComponent(trackId)}`;
  const data = (await getJson(url, 'deezer', intervalMs)) as DeezerTrack & { error?: unknown };
  if (data.error) return null;
  return toDeezerCandidate(data);
}

// ---------------------------------------------------------------- 對外

export async function matchSource(q: SourceQuery, opts: { intervalMs?: number } = {}): Promise<SourceMatchResult> {
  const intervalMs = opts.intervalMs ?? MIN_INTERVAL_MS[q.platform];
  const country = (q.country || 'TW').toUpperCase();
  try {
    if (q.mode === 'refresh') {
      if (!q.trackId) return { status: 'notfound', note: '沒有 track id，無法直接刷新' };
      const c = q.platform === 'apple' ? await appleLookup(q.trackId, country, intervalMs) : await deezerLookup(q.trackId, intervalMs);
      return c ? { status: 'refreshed', candidate: c } : { status: 'notfound', note: '這個 id 已查不到（可能已下架）' };
    }

    const first =
      q.platform === 'apple'
        ? await appleSearch(`${q.title} ${q.artist}`.trim(), 8, country, intervalMs)
        : await deezerSearch(`${q.title} ${q.artist}`.trim(), 8, intervalMs);
    let best = pickBest(first, q);
    let confidence: 'high' | 'low' = 'high';

    if (!best) {
      // 組合關鍵字沒對上時，只用歌名多撈幾筆再自行比對歌手（歌手寫法不一致時常有效）
      const second =
        q.platform === 'apple'
          ? await appleSearch(q.title, 25, country, intervalMs)
          : await deezerSearch(`track:"${q.title.replace(/"/g, '')}"`, 25, intervalMs);
      best = pickBest(second, q);
    }
    if (!best && first.length > 0) {
      // 退而求其次：相關性最高的一筆，標為低信心交給人工核對
      best = first[0];
      confidence = 'low';
    }
    if (!best) return { status: 'notfound' };

    let durationDiffSec: number | null = null;
    let note: string | undefined;
    if (q.durationSec && q.durationSec > 0 && best.durationSec > 0) {
      durationDiffSec = Math.abs(q.durationSec - best.durationSec);
      if (durationDiffSec > DURATION_MISMATCH_SEC && confidence === 'high') {
        confidence = 'low';
        note = `長度差 ${durationDiffSec} 秒，可能是不同版本`;
      }
    }
    if (confidence === 'low' && !note) note = '歌名或歌手不夠接近，請試聽確認';
    return { status: 'found', confidence, candidate: best, durationDiffSec, note };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : '查詢失敗' };
  }
}
