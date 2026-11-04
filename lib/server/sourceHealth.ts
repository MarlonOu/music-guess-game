/**
 * 來源健康檢查：掃描歌曲在 YouTube／Apple Music／Deezer 三種來源的狀態，找出已經或即將無法播放的來源。
 *
 * - YouTube：videos.list（每 50 支影片只消耗 1 單位配額）。檢查影片是否被刪除／設為私人／被拒絕、
 *   是否關閉外部嵌入（遊戲內會無聲）、台灣地區是否被封鎖、年齡限制、直播。
 * - Apple Music：iTunes lookup 一次最多帶多個 track id。檢查曲目是否下架、有沒有試聽片段、
 *   資料庫存的試聽網址是否仍與官方一致且可連線。
 * - Deezer：逐首查 /track/{id}。檢查曲目是否下架、有沒有試聽片段、是否可播放；沒有 track id 的歌曲
 *   則檢查存起來的試聽網址簽章是否過期（有 track id 的歌曲播放時會即時解析最新網址，不受影響）。
 *
 * 只做讀取與判斷，不寫入資料庫；修復動作由另一支 API 執行。評估邏輯（evaluate*）是純函式，可單獨測試。
 */
import type { HealthFinding, HealthPlatform, HealthScanResult } from '../types/sourceHealth';

export interface HealthSong {
  id: string;
  title: string;
  youtubeVideoId: string | null;
  appleMusicTrackId: string | null;
  appleMusicPreviewUrl: string | null;
  deezerTrackId: string | null;
  deezerPreviewUrl: string | null;
}

export class HealthScanError extends Error {
  constructor(
    message: string,
    public readonly status = 502
  ) {
    super(message);
  }
}

type Draft = Omit<HealthFinding, 'songId' | 'platform'>;

const FETCH_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 6000;
/** Apple 地區：與自動刷新腳本一致，預設台灣商店 */
const APPLE_COUNTRY = (process.env.AUTO_REFRESH_APPLE_COUNTRY || 'TW').toUpperCase();
const TARGET_REGION = 'TW';
/** Deezer 簽章網址剩餘時間低於這個值視為即將過期 */
const EXPIRING_SOON_SEC = 7 * 24 * 3600;
const DEEZER_INTERVAL_MS = 300;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function toFindings(songId: string, platform: HealthPlatform, drafts: Draft[]): HealthFinding[] {
  return drafts.map((d) => ({ songId, platform, ...d }));
}

function checkFailed(songId: string, platform: HealthPlatform, reason: string): HealthFinding {
  return { songId, platform, severity: 'warn', code: 'check-failed', message: `無法完成檢查（${reason}），請稍後重新掃描`, fix: null };
}

// ---------------------------------------------------------------- 網址探測

const PROBE_HOSTS: Record<'apple' | 'deezer', RegExp> = {
  apple: /(^|\.)(mzstatic\.com|apple\.com)$/i,
  deezer: /(^|\.)(dzcdn\.net|deezer\.com)$/i,
};

/** 只對已知的 CDN 網域發請求：資料庫的網址理論上都是來源平台給的，但仍不信任任意主機 */
export async function probeUrl(url: string, platform: 'apple' | 'deezer'): Promise<'alive' | 'dead' | 'unknown'> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'dead';
  }
  if (parsed.protocol !== 'https:' || !PROBE_HOSTS[platform].test(parsed.hostname)) return 'unknown';
  try {
    const res = await fetch(parsed, { headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    if (res.ok) return 'alive';
    if (res.status === 403 || res.status === 404 || res.status === 410) return 'dead';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------- YouTube

export interface YoutubeVideo {
  id: string;
  snippet?: { title?: string; liveBroadcastContent?: string };
  status?: { privacyStatus?: string; uploadStatus?: string; rejectionReason?: string; embeddable?: boolean };
  contentDetails?: { regionRestriction?: { allowed?: string[]; blocked?: string[] }; contentRating?: { ytRating?: string } };
}

const REJECTION_LABEL: Record<string, string> = {
  claim: '版權聲明',
  copyright: '侵犯版權',
  duplicate: '重複內容',
  inappropriate: '不當內容',
  length: '長度不符',
  termsOfUse: '違反服務條款',
  trademark: '商標問題',
  uploaderAccountClosed: '上傳者帳號已關閉',
  uploaderAccountSuspended: '上傳者帳號已停權',
};

/** 評估單一影片（video 為 undefined 代表 API 查不到：已刪除或私人） */
export function evaluateYoutube(video: YoutubeVideo | undefined): Draft[] {
  if (!video) {
    return [{ severity: 'error', code: 'yt-missing', message: '影片已被刪除或設為私人，查不到這支影片', fix: 'remove' }];
  }
  const out: Draft[] = [];
  const detail = video.snippet?.title;
  const status = video.status ?? {};
  if (status.privacyStatus === 'private') {
    out.push({ severity: 'error', code: 'yt-missing', message: '影片已設為私人', fix: 'remove', detail });
  }
  if (status.uploadStatus === 'rejected' || status.uploadStatus === 'deleted' || status.uploadStatus === 'failed') {
    const reason = status.rejectionReason ? `（${REJECTION_LABEL[status.rejectionReason] ?? status.rejectionReason}）` : '';
    out.push({ severity: 'error', code: 'yt-rejected', message: `影片已被 YouTube 移除或拒絕${reason}`, fix: 'remove', detail });
  }
  if (status.embeddable === false) {
    out.push({ severity: 'error', code: 'yt-not-embeddable', message: '擁有者已關閉外部嵌入播放，遊戲內會無聲', fix: 'remove', detail });
  }
  const region = video.contentDetails?.regionRestriction;
  if (region) {
    const blockedHere = region.blocked?.includes(TARGET_REGION) ?? false;
    const notAllowedHere = region.allowed !== undefined && !region.allowed.includes(TARGET_REGION);
    if (blockedHere || notAllowedHere) {
      out.push({ severity: 'error', code: 'yt-region-blocked', message: '影片在台灣地區被封鎖，台灣玩家無法播放', fix: 'remove', detail });
    } else if (region.blocked && region.blocked.length > 0) {
      out.push({
        severity: 'warn',
        code: 'yt-region-partial',
        message: `影片在 ${region.blocked.length} 個地區被封鎖（${region.blocked.slice(0, 6).join('、')}${region.blocked.length > 6 ? '…' : ''}），台灣不受影響`,
        fix: null,
        detail,
      });
    }
  }
  if (video.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') {
    out.push({ severity: 'warn', code: 'yt-age-restricted', message: '影片有年齡限制，嵌入播放時可能被要求登入而無法播放', fix: null, detail });
  }
  const live = video.snippet?.liveBroadcastContent;
  if (live === 'live' || live === 'upcoming') {
    out.push({ severity: 'warn', code: 'yt-live', message: live === 'live' ? '這是直播中的影片，不適合當題目來源' : '這是尚未開始的直播預告', fix: null, detail });
  }
  return out;
}

export async function scanYoutube(songs: HealthSong[]): Promise<HealthScanResult> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new HealthScanError('伺服器未設定 YOUTUBE_API_KEY，無法檢查 YouTube 來源', 500);
  const targets = songs.filter((s) => s.youtubeVideoId);
  const ids = Array.from(new Set(targets.map((s) => s.youtubeVideoId as string)));
  const byId = new Map<string, YoutubeVideo>();
  if (ids.length > 0) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails,status');
    url.searchParams.set('id', ids.join(','));
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('key', apiKey);
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw new HealthScanError('連線 YouTube API 逾時或失敗');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } };
      const reason = body.error?.errors?.[0]?.reason;
      throw new HealthScanError(reason === 'quotaExceeded' ? '今日 YouTube API 配額已用完，請明天再掃描' : `YouTube API 回應錯誤（HTTP ${res.status}${reason ? `：${reason}` : ''}）`);
    }
    const data = (await res.json()) as { items?: YoutubeVideo[] };
    for (const v of data.items ?? []) byId.set(v.id, v);
  }
  const findings: HealthFinding[] = [];
  for (const s of targets) findings.push(...toFindings(s.id, 'youtube', evaluateYoutube(byId.get(s.youtubeVideoId as string))));
  return { platform: 'youtube', checked: targets.length, findings };
}

// ---------------------------------------------------------------- Apple Music

export interface AppleTrack {
  trackId?: number;
  previewUrl?: string;
}

/** 評估單一曲目。probe 是「資料庫存的試聽網址」目前的連線狀態（網址與官方不同時才需要探測） */
export function evaluateApple(song: Pick<HealthSong, 'appleMusicPreviewUrl'>, track: AppleTrack | undefined, probe: 'alive' | 'dead' | 'unknown' | null): Draft[] {
  if (!track) {
    return [{ severity: 'error', code: 'apple-missing', message: `Apple Music（${APPLE_COUNTRY} 商店）已查不到這個曲目，可能已下架或該地區沒有`, fix: 'remove' }];
  }
  if (!track.previewUrl) {
    return [{ severity: 'error', code: 'apple-no-preview', message: 'Apple Music 的這個曲目已沒有試聽片段', fix: 'remove' }];
  }
  const stored = song.appleMusicPreviewUrl;
  if (!stored) {
    return [{ severity: 'error', code: 'apple-no-stored-url', message: '有 track id 但資料庫沒有試聽網址，遊戲內不會使用 Apple 來源', fix: 'refresh' }];
  }
  if (stored !== track.previewUrl) {
    if (probe === 'dead') {
      return [{ severity: 'error', code: 'apple-url-dead', message: '資料庫存的試聽網址已失效（過期），播放會失敗', fix: 'refresh' }];
    }
    return [{ severity: 'warn', code: 'apple-url-changed', message: 'Apple 已更換試聽網址，目前存的網址' + (probe === 'alive' ? '仍可播放' : '無法確認是否可播放'), fix: 'refresh' }];
  }
  return [];
}

async function appleLookupMany(ids: string[]): Promise<Map<string, AppleTrack>> {
  const url = `https://itunes.apple.com/lookup?id=${ids.map(encodeURIComponent).join(',')}&country=${APPLE_COUNTRY}`;
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw new HealthScanError('連線 Apple（iTunes）逾時或失敗');
    }
    if (res.status !== 403 && res.status !== 429) break;
    if (attempt === 0) await sleep(8000);
  }
  if (!res || !res.ok) throw new HealthScanError(`Apple（iTunes）回應錯誤（HTTP ${res?.status ?? '?'}），可能被限流，請稍後再試`);
  const data = (await res.json().catch(() => ({}))) as { results?: AppleTrack[] };
  const map = new Map<string, AppleTrack>();
  for (const t of data.results ?? []) if (t.trackId !== undefined) map.set(String(t.trackId), t);
  return map;
}

export async function scanApple(songs: HealthSong[]): Promise<HealthScanResult> {
  const targets = songs.filter((s) => s.appleMusicTrackId || s.appleMusicPreviewUrl);
  const withId = targets.filter((s) => s.appleMusicTrackId);
  const lookup = withId.length > 0 ? await appleLookupMany(Array.from(new Set(withId.map((s) => s.appleMusicTrackId as string)))) : new Map<string, AppleTrack>();
  const findings: HealthFinding[] = [];
  for (const s of targets) {
    if (s.appleMusicTrackId) {
      const track = lookup.get(s.appleMusicTrackId);
      const needProbe = Boolean(track?.previewUrl && s.appleMusicPreviewUrl && s.appleMusicPreviewUrl !== track.previewUrl);
      const probe = needProbe ? await probeUrl(s.appleMusicPreviewUrl as string, 'apple') : null;
      findings.push(...toFindings(s.id, 'apple', evaluateApple(s, track, probe)));
    } else {
      // 只有網址、沒有 track id：無法向官方比對，只能確認網址還連得上
      const probe = await probeUrl(s.appleMusicPreviewUrl as string, 'apple');
      if (probe === 'dead') {
        findings.push(...toFindings(s.id, 'apple', [{ severity: 'error', code: 'apple-url-dead', message: '試聽網址已失效，且沒有 track id 無法自動刷新', fix: 'remove' }]));
      }
    }
  }
  return { platform: 'apple', checked: targets.length, findings };
}

// ---------------------------------------------------------------- Deezer

export interface DeezerTrack {
  preview?: string;
  readable?: boolean;
  error?: { code?: number; type?: string };
}

/** 從 Deezer 簽章試聽網址取出到期時間（unix 秒）；沒有簽章回傳 null */
export function parseDeezerExpiry(url: string): number | null {
  const m = /[?&~]?exp=(\d{9,11})/.exec(url);
  return m ? Number(m[1]) : null;
}

/** 評估有 track id 的曲目（track 為 undefined 代表查不到） */
export function evaluateDeezerTrack(track: DeezerTrack | undefined): Draft[] {
  if (!track) {
    return [{ severity: 'error', code: 'deezer-missing', message: 'Deezer 已查不到這個曲目，可能已下架', fix: 'remove' }];
  }
  if (!track.preview) {
    return [{ severity: 'error', code: 'deezer-no-preview', message: 'Deezer 的這個曲目已沒有試聽片段', fix: 'remove' }];
  }
  if (track.readable === false) {
    return [
      {
        severity: 'warn',
        code: 'deezer-unreadable',
        message: '以伺服器所在地區查詢時，這個曲目標示為不可播放（readable=false）；台灣玩家是否受影響需實測',
        fix: null,
      },
    ];
  }
  return [];
}

/** 評估沒有 track id、只有存起來試聽網址的歌曲 */
export function evaluateDeezerStoredUrl(url: string, nowSec: number, probe: 'alive' | 'dead' | 'unknown' | null): Draft[] {
  const exp = parseDeezerExpiry(url);
  if (exp !== null) {
    if (exp <= nowSec) {
      return [{ severity: 'error', code: 'deezer-url-expired', message: '試聽網址的簽章已過期，且沒有 track id 無法自動解析，播放會失敗', fix: 'remove', detail: `到期：${new Date(exp * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}` }];
    }
    if (exp - nowSec < EXPIRING_SOON_SEC) {
      return [{ severity: 'warn', code: 'deezer-url-expiring', message: '試聽網址即將過期，且沒有 track id 無法自動解析', fix: null, detail: `到期：${new Date(exp * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}` }];
    }
    return [];
  }
  if (probe === 'dead') {
    return [{ severity: 'error', code: 'deezer-url-dead', message: '試聽網址已失效，且沒有 track id 無法自動解析', fix: 'remove' }];
  }
  return [];
}

async function deezerFetchTrack(id: string): Promise<DeezerTrack | undefined | 'failed'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.deezer.com/track/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.status === 429 || res.status === 403) {
        if (attempt === 0) {
          await sleep(5000);
          continue;
        }
        return 'failed';
      }
      if (!res.ok) return 'failed';
      const data = (await res.json()) as DeezerTrack;
      if (data.error) {
        // code 4：頻率過高（不是曲目不存在）；800：查無此資料
        if (data.error.code === 4 && attempt === 0) {
          await sleep(5000);
          continue;
        }
        return data.error.code === 800 || data.error.type === 'DataException' ? undefined : 'failed';
      }
      return data;
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}

export async function scanDeezer(songs: HealthSong[]): Promise<HealthScanResult> {
  const targets = songs.filter((s) => s.deezerTrackId || s.deezerPreviewUrl);
  const findings: HealthFinding[] = [];
  const nowSec = Math.floor(Date.now() / 1000);
  let first = true;
  for (const s of targets) {
    if (s.deezerTrackId) {
      if (!first) await sleep(DEEZER_INTERVAL_MS);
      first = false;
      const track = await deezerFetchTrack(s.deezerTrackId);
      if (track === 'failed') findings.push(checkFailed(s.id, 'deezer', 'Deezer 連線失敗或被限流'));
      else findings.push(...toFindings(s.id, 'deezer', evaluateDeezerTrack(track)));
    } else {
      const url = s.deezerPreviewUrl as string;
      const probe = parseDeezerExpiry(url) === null ? await probeUrl(url, 'deezer') : null;
      findings.push(...toFindings(s.id, 'deezer', evaluateDeezerStoredUrl(url, nowSec, probe)));
    }
  }
  return { platform: 'deezer', checked: targets.length, findings };
}

export async function scanPlatform(platform: HealthPlatform, songs: HealthSong[]): Promise<HealthScanResult> {
  if (platform === 'youtube') return scanYoutube(songs);
  if (platform === 'apple') return scanApple(songs);
  return scanDeezer(songs);
}
