/**
 * 歌曲主題自動判斷（管理頁面播放清單匯入用）。
 *
 * 做法（混合式）：
 * 1. 事實查詢：用 iTunes Search API（免金鑰、可指定台灣商店）依「歌手 + 歌名」查出發行年份與曲風。
 *    年代、曲風是可查證的客觀資料，不交給模型憑印象猜。
 * 2. 語意判斷：把「既有主題清單（名稱＋說明）」與每首歌的歌名、歌手、查到的年份曲風交給 Claude，
 *    請它只從既有主題裡挑，沒把握就留空。主題是管理者自訂的，所以模型只能「選」，不能創造新主題。
 * 3. 備援：沒有設定 ANTHROPIC_API_KEY 或 API 失敗時，用規則比對（年份對年代主題、曲風對關鍵字主題）。
 *
 * 結果只是「建議」，由管理者在匯入前檢查、修改，不會直接寫入資料庫。
 */

export interface SuggestItem {
  key: string;
  title: string;
  artist: string;
}

export interface SuggestTheme {
  id: string;
  name: string;
  description: string;
}

export interface SuggestResult {
  key: string;
  themeIds: string[];
  /** 給管理者看的簡短依據，例如「2004 年・Mandopop・男歌手」 */
  reason: string;
}

export interface SuggestResponse {
  results: SuggestResult[];
  mode: 'ai' | 'rules';
  /** 有查到年份／曲風事實的歌曲數 */
  factsFound: number;
  warnings: string[];
}

interface Facts {
  year?: number;
  genre?: string;
}

const ITUNES_TIMEOUT_MS = 5000;
const AI_BATCH_SIZE = 20;
const DEFAULT_MODEL = 'claude-sonnet-5-5';

const factsCache = new Map<string, Facts | null>();

/** 去掉影片標題常見的雜訊（括號內容、Official MV、Lyrics 等），留下適合搜尋的歌名 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/[【\[（(][^】\]）)]*[】\]）)]/g, ' ')
    .replace(/official\s*(music\s*)?(video|mv|audio)|lyrics?\s*video|\bmv\b|\bm\/v\b|完整版|歌詞版|動態歌詞|高音質|hd|4k/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 去掉 YouTube 自動產生的頻道名稱後綴（"David Tao - Topic"、"JJLinVEVO"、"某某 官方頻道"），還原成歌手名稱 */
export function cleanArtist(raw: string): string {
  return raw
    .replace(/\s*[-–—]\s*topic$/i, '')
    .replace(/\s*vevo$/i, '')
    .replace(/\s*(official\s*(channel|artist\s*channel)?|官方頻道|官方channel)$/i, '')
    .trim();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s　·・\-_.,，。]/g, '');
}

async function lookupFacts(rawItem: SuggestItem): Promise<Facts | null> {
  const item = { ...rawItem, artist: cleanArtist(rawItem.artist) };
  const title = cleanTitle(item.title);
  const cacheKey = `${normalize(item.artist)}|${normalize(title)}`;
  if (factsCache.has(cacheKey)) return factsCache.get(cacheKey) ?? null;

  const wantArtist = normalize(item.artist);
  const wantTitle = normalize(title);
  type Track = { trackName?: string; artistName?: string; primaryGenreName?: string; releaseDate?: string };

  async function search(term: string, limit: number): Promise<Track[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ITUNES_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=TW&media=music&entity=song&limit=${limit}`,
        { signal: controller.signal }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: Track[] };
      return data.results ?? [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  // 歌手與歌名都要「互相包含」才算命中，避免查到同名但不同人的歌而給出錯誤年份；
  // iTunes 的歌手欄位常是「陶喆 David Tao」這種中英並列，所以用包含而非相等
  const pick = (tracks: Track[]) =>
    tracks.find((r) => {
      const a = normalize(r.artistName ?? '');
      const t = normalize(r.trackName ?? '');
      const artistOk = !wantArtist || (a && (a.includes(wantArtist) || wantArtist.includes(a)));
      const titleOk = t && wantTitle && (wantTitle.includes(t) || t.includes(wantTitle));
      return artistOk && titleOk;
    });

  // 先用「歌手 + 歌名」，查不到再只用歌名撈較多筆自行比對歌手（歌手名稱寫法不一致時常有效）
  let hit = pick(await search(`${item.artist} ${title}`.trim(), 5));
  if (!hit && title) hit = pick(await search(title, 25));
  const year = hit?.releaseDate ? new Date(hit.releaseDate).getUTCFullYear() : undefined;
  const facts: Facts | null = hit ? { year: Number.isFinite(year) ? year : undefined, genre: hit.primaryGenreName } : null;
  // 網路錯誤與「真的查不到」無法區分，不快取 null，下次仍可重試
  if (facts) factsCache.set(cacheKey, facts);
  return facts;
}

async function lookupAllFacts(items: SuggestItem[]): Promise<Map<string, Facts | null>> {
  const out = new Map<string, Facts | null>();
  const queue = [...items];
  const workers = Array.from({ length: 5 }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      out.set(item.key, await lookupFacts(item));
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------- 規則備援

const GENRE_KEYWORDS: { genre: RegExp; theme: RegExp }[] = [
  { genre: /rock|metal|punk|alternative/i, theme: /搖滾|rock|樂團|band/i },
  { genre: /hip-?hop|rap/i, theme: /嘻哈|說唱|饒舌|hip|rap/i },
  { genre: /r&b|soul/i, theme: /r&b|rnb|節奏藍調/i },
  { genre: /folk|acoustic/i, theme: /民謠|folk/i },
  { genre: /electronic|dance|edm|house|techno/i, theme: /電子|舞曲|edm|dance/i },
  { genre: /jazz|blues/i, theme: /爵士|jazz|藍調/i },
  { genre: /classical|soundtrack|score/i, theme: /古典|原聲|配樂|ost/i },
  { genre: /k-?pop/i, theme: /韓|k-?pop/i },
  { genre: /j-?pop|anime/i, theme: /日|j-?pop|動漫|anime/i },
];

function decadeOf(year: number): { full: string; short: string } {
  const d = Math.floor(year / 10) * 10;
  return { full: String(d), short: String(d % 100).padStart(2, '0') };
}

function themeMatchesDecade(theme: SuggestTheme, year: number): boolean {
  const { full, short } = decadeOf(year);
  const text = `${theme.name}`;
  if (new RegExp(`(^|\\D)${full}\\s*(年代|s\\b|後)`, 'i').test(text)) return true;
  if (new RegExp(`(^|\\D)${short}\\s*(年代|s\\b)`, 'i').test(text) && !/^\d{4}/.test(text)) return true;
  // 「千禧」＝2000 年前後
  if (/千禧|2000s?/i.test(text) && year >= 2000 && year <= 2009) return true;
  return false;
}

function ruleSuggest(item: SuggestItem, facts: Facts | null, themes: SuggestTheme[]): SuggestResult {
  const ids: string[] = [];
  const reasons: string[] = [];
  if (facts?.year) {
    const matched = themes.filter((t) => themeMatchesDecade(t, facts.year!));
    if (matched.length > 0) {
      ids.push(...matched.map((t) => t.id));
      reasons.push(`${facts.year} 年`);
    }
  }
  if (facts?.genre) {
    for (const rule of GENRE_KEYWORDS) {
      if (!rule.genre.test(facts.genre)) continue;
      const matched = themes.filter((t) => rule.theme.test(t.name));
      if (matched.length > 0) {
        ids.push(...matched.map((t) => t.id));
        reasons.push(facts.genre);
      }
    }
  }
  return { key: item.key, themeIds: Array.from(new Set(ids)), reason: reasons.join('・') };
}

// ---------------------------------------------------------------- Claude

/** 年代類主題（「2000年代」「90年代」「千禧」）對應的年代起點；不是年代主題回傳 null */
function themeDecade(theme: SuggestTheme): number | null {
  const m = theme.name.match(/(?:(19|20)(\d)0|(\d)0)\s*年代/);
  if (m) {
    if (m[1]) return Number(`${m[1]}${m[2]}0`);
    const short = Number(m[3]) * 10;
    return short >= 50 ? 1900 + short : 2000 + short;
  }
  if (/千禧|2000s/i.test(theme.name)) return 2000;
  return null;
}

function buildPrompt(items: SuggestItem[], facts: Map<string, Facts | null>, themes: SuggestTheme[]): string {
  return JSON.stringify({
    themes: themes.map((t) => ({ id: t.id, name: t.name, description: t.description })),
    songs: items.map((i) => {
      const f = facts.get(i.key);
      return {
        key: i.key,
        title: cleanTitle(i.title),
        artist: cleanArtist(i.artist),
        verifiedReleaseYear: f?.year ?? null,
        verifiedGenre: f?.genre ?? null,
      };
    }),
  });
}

const SYSTEM_PROMPT = `你是熟悉華語、日韓與西洋流行音樂的資深音樂資料編輯。使用者會給你「主題清單」(themes) 與一批歌曲 (songs)，
請判斷每首歌「確實」屬於哪些主題。寧可少選，也不要為了湊數而選。

【每首歌的作業流程】
1. recognized：你是否真的認得這首歌（歌手＋歌名都對得上你的記憶）？認不得就填 false，themes 留空，不要憑歌手名字猜。
2. year：這首歌首次發行的西元年份。verifiedReleaseYear 不是 null 時直接採用（已查證）；否則依你的記憶填寫，不確定填 null。
3. 逐一檢查主題，只選有具體依據的。每個選中的主題都要附 why（15 字內的具體事實，例如「2007 年專輯《ＸＸ》主打」
   「男歌手、獨唱」），不可寫「經典情歌」「常見曲目」這類空泛敘述。
4. confidence：0 到 1，代表你對「這首歌屬於這個主題」的把握；低於 0.7 就不要選。

【主題分兩類，標準不同】
- 客觀可查證：年代（依 year 的十年區間，且只能選一個年代主題）、歌手性別／團體／獨唱、語言、曲風。依事實判斷即可。
- 主觀評價：KTV 必唱、經典必聽、抖音神曲、深夜 EMO、告白甜歌、聚會合唱、通勤歌單等。必須有具體佐證才能選
  （例如拿過金曲獎／長年榜單前段／廣為人知的 KTV 熱門曲／確實是短影音爆紅曲，歌詞情境確實吻合），並且 confidence 要 ≥ 0.8。
  沒有明確佐證的主觀主題一律不選；同一首歌最多選 2 個主觀主題。
- 一首歌最多選 5 個主題。

【規則】
- 只能使用 themes 裡的 id，不可自創。主題的 description 是管理者對該主題的定義，以它為準。
- artist 若帶有「- Topic」「VEVO」「官方頻道」等頻道後綴請忽略。
- 只輸出 JSON 陣列，不要任何其他文字：
[{"key":"...","recognized":true,"year":2007,"themes":[{"id":"...","why":"...","confidence":0.9}]}]`;

async function callClaude(prompt: string): Promise<string> {
  const base = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, '') || 'https://api.anthropic.com';
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 8192,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).map((c) => c.text ?? '').join('');
}

const MIN_CONFIDENCE = 0.7;
const MAX_THEMES_PER_SONG = 5;

interface ParsedSong {
  key: string;
  recognized: boolean;
  year: number | null;
  picks: { id: string; why: string; confidence: number }[];
}

/** 從模型回覆中取出 JSON 陣列並過濾：id 必須存在於主題清單、key 必須是請求過的、信心不足的主題丟掉 */
export function parseModelOutput(text: string, items: SuggestItem[], themes: SuggestTheme[]): ParsedSong[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const validThemes = new Set(themes.map((t) => t.id));
  const validKeys = new Set(items.map((i) => i.key));
  const out: ParsedSong[] = [];
  for (const row of parsed as { key?: unknown; recognized?: unknown; year?: unknown; themes?: unknown }[]) {
    if (typeof row?.key !== 'string' || !validKeys.has(row.key)) continue;
    const recognized = row.recognized !== false;
    const picks: ParsedSong['picks'] = [];
    if (recognized && Array.isArray(row.themes)) {
      for (const t of row.themes as { id?: unknown; why?: unknown; confidence?: unknown }[]) {
        if (typeof t?.id !== 'string' || !validThemes.has(t.id)) continue;
        const confidence = typeof t.confidence === 'number' ? t.confidence : 0;
        if (confidence < MIN_CONFIDENCE) continue;
        picks.push({ id: t.id, why: typeof t.why === 'string' ? t.why.trim().slice(0, 40) : '', confidence });
      }
    }
    picks.sort((a, b) => b.confidence - a.confidence);
    const year = typeof row.year === 'number' && row.year >= 1900 && row.year <= 2100 ? Math.round(row.year) : null;
    out.push({ key: row.key, recognized, year, picks: picks.slice(0, MAX_THEMES_PER_SONG) });
  }
  return out;
}

/**
 * 把模型選擇與可查證的事實整合成最終結果：
 * - 年代主題只由年份決定（查證到的年份優先，否則採模型在「認得這首歌」時給的年份），模型選的年代一律捨棄重算，
 *   避免「2007 年的歌被標成 2000 年代＋2010 年代」或憑印象標錯年代。
 * - 依據文字逐主題列出（「2000年代：2007 年發行（iTunes）；華語流行：…」），不再是一句籠統的總評。
 */
function reconcile(song: ParsedSong, fact: Facts | null, themes: SuggestTheme[]): SuggestResult {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const parts: { id: string; why: string }[] = [];
  const year = fact?.year ?? (song.recognized ? song.year : null);
  if (year) {
    const decadeThemes = themes.filter((t) => themeMatchesDecade(t, year));
    for (const t of decadeThemes) parts.push({ id: t.id, why: fact?.year ? `${year} 年發行（iTunes）` : `約 ${year} 年（模型推估）` });
  }
  for (const pick of song.picks) {
    const theme = byId.get(pick.id);
    if (!theme || themeDecade(theme) !== null) continue; // 年代主題已由年份決定
    parts.push({ id: pick.id, why: pick.why });
  }
  const unique = Array.from(new Map(parts.map((p) => [p.id, p])).values());
  const reason = !song.recognized && unique.length === 0
    ? '模型不認得這首歌，且查不到年份'
    : unique.map((p) => `${byId.get(p.id)?.name ?? ''}${p.why ? `：${p.why}` : ''}`).join('；');
  return { key: song.key, themeIds: unique.map((p) => p.id), reason: reason.slice(0, 400) };
}

export async function suggestThemes(items: SuggestItem[], themes: SuggestTheme[]): Promise<SuggestResponse> {
  const warnings: string[] = [];
  const facts = await lookupAllFacts(items);
  const factsFound = Array.from(facts.values()).filter((f) => f && (f.year || f.genre)).length;
  if (factsFound === 0 && items.length > 0) warnings.push('查不到任何年份／曲風資料，年代類主題的判斷會比較不準');

  if (process.env.ANTHROPIC_API_KEY) {
    const results = new Map<string, SuggestResult>();
    let aiFailed = false;
    let unparsedBatches = 0;
    for (let i = 0; i < items.length; i += AI_BATCH_SIZE) {
      const batch = items.slice(i, i + AI_BATCH_SIZE);
      try {
        const text = await callClaude(buildPrompt(batch, facts, themes));
        const parsed = parseModelOutput(text, batch, themes);
        if (parsed.length === 0) {
          unparsedBatches += 1;
          console.error('[themeSuggest] 無法解析模型回覆：', text.slice(0, 500));
        }
        for (const r of parsed) results.set(r.key, reconcile(r, facts.get(r.key) ?? null, themes));
      } catch (err) {
        aiFailed = true;
        console.error('[themeSuggest] Claude 呼叫失敗：', err);
      }
    }
    // 模型沒回的歌曲（失敗或漏掉）改用規則補上
    for (const item of items) {
      if (!results.has(item.key)) results.set(item.key, ruleSuggest(item, facts.get(item.key) ?? null, themes));
    }
    if (unparsedBatches > 0) warnings.push('AI 回覆格式無法解析，已改用規則（年份／曲風）補上，詳見伺服器日誌');
    if (aiFailed) warnings.push('部分歌曲 AI 判斷失敗，已改用規則（年份／曲風）補上');
    return { results: items.map((i) => results.get(i.key)!), mode: aiFailed || unparsedBatches === Math.ceil(items.length / AI_BATCH_SIZE) ? 'rules' : 'ai', factsFound, warnings };
  }

  warnings.push('伺服器未設定 ANTHROPIC_API_KEY，僅用年份／曲風規則判斷（無法判斷歌手性別、情境等語意類主題）');
  return {
    results: items.map((i) => ruleSuggest(i, facts.get(i.key) ?? null, themes)),
    mode: 'rules',
    factsFound,
    warnings,
  };
}
