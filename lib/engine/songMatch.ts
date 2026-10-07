/**
 * 播放清單匯入用的「影片標題 → 歌名／歌手」處理與題庫重複比對（純函式，前後端皆可使用）。
 *
 * 為什麼不能只比 youtubeVideoId：同一首歌常有多支影片（官方 MV、歌詞版、Live），
 * videoId 不同但其實已經在題庫裡。影片標題又常是「歌手 英文名-歌手 英文名【歌名 英文歌名】Official MV」
 * 這種格式，整串直接跟題庫歌名比對永遠對不上。
 *
 * 做法：
 * 1. 把影片標題拆成「括號內容」與「括號外的片段」，去掉 Official MV 等雜訊，
 *    再把每個片段依中日韓文字／其他文字交界切開，產生一組「候選歌名」。
 * 2. 候選歌名只做「完整相等」比對（正規化後），對象是題庫歌名與別名。
 *    不做子字串比對——短歌名（例如「愛」）會誤中大量不相關標題。
 * 3. 歌名命中後再確認歌手：題庫歌手名稱要出現在標題、頻道名稱或目前輸入的歌手欄位中。
 *    歌名命中但歌手對不上，只回報 'title'（提示，不視為重複）。
 */

export interface MatchableSong {
  id: string;
  title: string;
  aliases: string[];
  artistName: string;
  youtubeVideoId?: string;
}

export type SongMatchKind = 'video' | 'same' | 'title';

export interface SongMatch {
  /** video：同一個 YouTube 影片；same：歌名（或別名）與歌手都對上；title：只有歌名對上、歌手不同 */
  kind: SongMatchKind;
  song: MatchableSong;
  /** 是靠歌名還是別名對上的 */
  via: 'title' | 'alias' | 'video';
}

export interface SongMatchIndex {
  byTitleKey: Map<string, { song: MatchableSong; via: 'title' | 'alias' }[]>;
  byVideoId: Map<string, MatchableSong>;
  artistKeys: Map<string, string>; // 正規化歌手名 → 原始名稱
}

export interface MatchInput {
  videoId: string;
  /** YouTube 原始影片標題 */
  rawTitle: string;
  /** 目前（可能已編輯）的歌名 */
  songTitle: string;
  /** 目前（可能已編輯）的歌手 */
  artistName: string;
  channelTitle: string;
  /** 歌名／歌手都還是自動帶入的值時為 true：額外使用原始標題與頻道名稱當佐證 */
  useRaw: boolean;
}

const CJK = '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af\\uff66-\\uff9f';
const CJK_CHAR = new RegExp(`[${CJK}]`);
const CJK_OR_OTHER_RUNS = new RegExp(`[${CJK}]+|[^${CJK}]+`, 'g');
const BRACKET_PAIRS = /[【\[（(「『《〈<]([^】\]）)」』》〉>]*)[】\]）)」』》〉>]/g;
const SEPARATORS = /[–—―|｜/／：\u0001]|\s[-:]\s/;
const CJK_DASH = /([\u3040-\u9fff])-|-([\u3040-\u9fff])/g;

/** 影片標題常見的非歌名雜訊字樣 */
const NOISE_TOKENS =
  /official\s*(?:music\s*)?(?:video|mv|audio|lyric\s*video|visualizer)?|(?:music|lyric|lyrics)\s*video|\blyrics?\b|\bm\/v\b|\bmv\b|\bhd\b|\b4k\b|\b1080p\b|\baudio\b|\bvisualizer\b|官方(?:完整)?(?:版|mv|音檔)?|完整版|歌詞版|歌词版|動態歌詞|动态歌词|高畫質|高音質|高清|字幕版?/gi;

/** 比對用正規化：全形轉半形、小寫、去掉空白與所有標點符號 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s -¿ -⁯　-〿!-/:-@[-`{-~]/g, '');
}

function stripNoise(s: string): string {
  return s.replace(NOISE_TOKENS, ' ').replace(/\s+/g, ' ').trim();
}

/** 內容扣掉雜訊字樣、標點之後什麼都不剩，就視為雜訊括號（例如 [Official MV]、(HD)） */
function isNoisePiece(s: string): boolean {
  return normalizeForMatch(stripNoise(s)).length === 0;
}

interface TitlePieces {
  brackets: string[];
  outside: string;
}

function splitPieces(raw: string): TitlePieces {
  const brackets: string[] = [];
  const outside = raw.replace(BRACKET_PAIRS, (_m, inner: string) => {
    brackets.push(inner.trim());
    return ' ';
  });
  return { brackets, outside: outside.replace(/\s+/g, ' ').trim() };
}

function splitSegments(s: string): string[] {
  // 連字號只在緊鄰中日韓文字時才當分隔（「周杰倫 Jay Chou-周杰倫」），避免切壞 Jay-Z 這類英文名
  return s
    .replace(CJK_DASH, (_m, a: string | undefined, b: string | undefined) => `${a ?? ''}\u0001${b ?? ''}`)
    .split(SEPARATORS)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function cjkRuns(s: string): string[] {
  return (s.match(CJK_OR_OTHER_RUNS) ?? []).map((x) => x.trim()).filter((x) => x.length > 0);
}

function pieceVariants(piece: string): string[] {
  const clean = stripNoise(piece);
  if (!clean) return [];
  const out = [clean];
  const runs = cjkRuns(clean);
  if (runs.length > 1) out.push(...runs);
  return out;
}

/** 由一段標題文字產生候選歌名（已正規化、去重） */
function candidateKeys(text: string): Set<string> {
  const { brackets, outside } = splitPieces(text);
  const pieces: string[] = [];
  const cleanOutside = stripNoise(outside);
  if (cleanOutside) {
    pieces.push(cleanOutside, ...splitSegments(cleanOutside));
  }
  for (const b of brackets) pieces.push(b);
  // 括號文字直接併回括號外（「好好（想把你寫成一首歌）」這種括號屬於歌名的情況）
  const joined = stripNoise(text.replace(BRACKET_PAIRS, (_m, inner: string) => ` ${inner} `));
  if (joined) pieces.push(joined);

  const keys = new Set<string>();
  for (const p of pieces) {
    for (const v of pieceVariants(p)) {
      const k = normalizeForMatch(v);
      if (k) keys.add(k);
    }
  }
  return keys;
}

export function buildSongMatchIndex(songs: MatchableSong[]): SongMatchIndex {
  const byTitleKey: SongMatchIndex['byTitleKey'] = new Map();
  const byVideoId = new Map<string, MatchableSong>();
  const artistKeys = new Map<string, string>();
  const add = (key: string, song: MatchableSong, via: 'title' | 'alias') => {
    if (!key) return;
    const list = byTitleKey.get(key) ?? [];
    if (!list.some((x) => x.song.id === song.id)) list.push({ song, via });
    byTitleKey.set(key, list);
  };
  for (const s of songs) {
    add(normalizeForMatch(s.title), s, 'title');
    for (const a of s.aliases) add(normalizeForMatch(a), s, 'alias');
    if (s.youtubeVideoId) byVideoId.set(s.youtubeVideoId, s);
    const ak = normalizeForMatch(s.artistName);
    if (ak) artistKeys.set(ak, s.artistName);
  }
  return { byTitleKey, byVideoId, artistKeys };
}

function artistSupported(songArtist: string, evidence: string[]): boolean {
  const na = normalizeForMatch(songArtist);
  if (!na) return false;
  return evidence.some((e) => e.length > 0 && (e.includes(na) || (e.length >= 2 && na.includes(e))));
}

export function findSongMatch(index: SongMatchIndex, input: MatchInput): SongMatch | null {
  const byVideo = index.byVideoId.get(input.videoId);
  if (byVideo) return { kind: 'video', song: byVideo, via: 'video' };

  const rawKey = normalizeForMatch(input.rawTitle);
  const artistKey = normalizeForMatch(input.artistName);
  const evidence = [artistKey];
  if (input.useRaw) evidence.push(rawKey, normalizeForMatch(input.channelTitle));

  const candidates = candidateKeys(input.songTitle);
  if (input.useRaw) for (const k of candidateKeys(input.rawTitle)) candidates.add(k);

  // 與歌手同名的候選（標題裡的「周杰倫」）不當歌名，避免歌手名稱誤中同名歌曲；
  // 全部都被排除時才退回使用原本的候選（歌名就是歌手名的情況）
  const knownArtists = new Set<string>([artistKey, ...(input.useRaw ? [normalizeForMatch(input.channelTitle)] : [])]);
  for (const ak of index.artistKeys.keys()) {
    if (rawKey.includes(ak) || artistKey === ak) knownArtists.add(ak);
  }
  const filtered = Array.from(candidates).filter((k) => !knownArtists.has(k));
  const usable = filtered.length > 0 ? filtered : Array.from(candidates);

  let titleOnly: SongMatch | null = null;
  for (const key of usable) {
    const hits = index.byTitleKey.get(key);
    if (!hits) continue;
    for (const h of hits) {
      if (artistSupported(h.song.artistName, evidence)) return { kind: 'same', song: h.song, via: h.via };
      if (!titleOnly) titleOnly = { kind: 'title', song: h.song, via: h.via };
    }
  }
  return titleOnly;
}

export function isDuplicateMatch(m: SongMatch | null): boolean {
  return m !== null && m.kind !== 'title';
}

function isArtistish(seg: string, hints: string[]): boolean {
  let n = normalizeForMatch(seg);
  if (!n) return true;
  let hitCjkHint = false;
  for (const h of hints) {
    if (h.length < 2 || !n.includes(h)) continue;
    if (CJK_CHAR.test(h)) hitCjkHint = true;
    n = n.split(h).join('');
  }
  if (n.length === 0) return true;
  // 「周杰倫 Jay Chou」：中文歌手名之外只剩英文字母＝英文譯名
  return hitCjkHint && !CJK_CHAR.test(n) && /^[a-z0-9]+$/.test(n);
}

/**
 * 由影片標題推測歌名與別名。以「保守」為原則：無法判斷時回傳去掉雜訊的原標題，
 * 結果只是匯入前的預設值，管理者可以在每一列修改。
 */
export function suggestSongFields(rawTitle: string, artistHints: string[]): { title: string; aliases: string[] } {
  const originals = Array.from(new Set(artistHints.map((h) => h.trim()).filter((h) => normalizeForMatch(h).length >= 2)));
  const hints = originals.map(normalizeForMatch);
  const { brackets, outside } = splitPieces(rawTitle);
  const segs = splitSegments(stripNoise(outside))
    .filter((s) => !isArtistish(s, hints))
    .map((s) => removeHints(s, originals))
    .filter((s) => s.length > 0);
  const usefulBrackets = brackets.filter((b) => !isNoisePiece(b) && !isArtistish(b, hints));

  if (segs.length > 0) {
    let title = segs[0];
    const cjkBracket = usefulBrackets.find((b) => CJK_CHAR.test(b) && !/^(?:live|ver|version|remix|cover)/i.test(b));
    if (cjkBracket && segs.length === 1) title = `${title}（${cjkBracket}）`;
    return { title, aliases: [] };
  }
  if (usefulBrackets.length > 0) {
    const b = usefulBrackets[0];
    // 「愛在西元前 Love before AD」→ 歌名取中文，英文譯名當別名
    const m = b.match(new RegExp(`^([^A-Za-z]*[${CJK}][^A-Za-z]*?)\\s+([A-Za-z][\\s\\S]*)$`));
    if (m) return { title: m[1].trim(), aliases: [m[2].trim()] };
    return { title: b, aliases: [] };
  }
  return { title: stripNoise(rawTitle) || rawTitle.trim(), aliases: [] };
}

/** 「周杰倫 晴天」這種歌手與歌名同一段、以空白相連的標題：把歌手名稱從片段裡拿掉 */
function removeHints(seg: string, originals: string[]): string {
  let out = seg;
  for (const h of originals) {
    const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'gi'), ' ');
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > 0 && normalizeForMatch(out).length > 0 ? out : seg;
}

/** 供建議歌名使用的歌手線索：頻道名稱＋題庫中名稱出現在標題裡的歌手 */
export function artistHintsFor(index: SongMatchIndex, rawTitle: string, channelTitle: string): string[] {
  const rawKey = normalizeForMatch(rawTitle);
  const hints = [channelTitle];
  for (const [key, name] of index.artistKeys) {
    if (key.length >= 2 && rawKey.includes(key)) hints.push(name);
  }
  return hints;
}

/**
 * 預設歌手：標題或頻道名稱裡出現題庫既有的歌手名稱時，直接採用該名稱
 * （頻道「周杰倫 Jay Chou」→ 既有歌手「周杰倫」），避免匯入時多建一個名稱略有差異的重複歌手；
 * 找不到才退回頻道名稱。多個命中時取名稱最長者。
 */
export function suggestArtistName(index: SongMatchIndex, rawTitle: string, channelTitle: string): string {
  const hay = `${normalizeForMatch(channelTitle)}|${normalizeForMatch(rawTitle)}`;
  let best: { key: string; name: string } | null = null;
  for (const [key, name] of index.artistKeys) {
    if (key.length < 2 || !hay.includes(key)) continue;
    if (!best || key.length > best.key.length) best = { key, name };
  }
  return best?.name ?? channelTitle;
}
