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
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const factsCache = new Map<string, Facts | null>();

/** 去掉影片標題常見的雜訊（括號內容、Official MV、Lyrics 等），留下適合搜尋的歌名 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/[【\[（(][^】\]）)]*[】\]）)]/g, ' ')
    .replace(/official\s*(music\s*)?(video|mv|audio)|lyrics?\s*video|\bmv\b|\bm\/v\b|完整版|歌詞版|動態歌詞|高音質|hd|4k/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s　·・\-_.,，。]/g, '');
}

async function lookupFacts(item: SuggestItem): Promise<Facts | null> {
  const title = cleanTitle(item.title);
  const cacheKey = `${normalize(item.artist)}|${normalize(title)}`;
  if (factsCache.has(cacheKey)) return factsCache.get(cacheKey) ?? null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ITUNES_TIMEOUT_MS);
  try {
    const term = encodeURIComponent(`${item.artist} ${title}`.trim());
    const res = await fetch(`https://itunes.apple.com/search?term=${term}&country=TW&media=music&entity=song&limit=5`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { trackName?: string; artistName?: string; primaryGenreName?: string; releaseDate?: string }[];
    };
    const wantArtist = normalize(item.artist);
    const wantTitle = normalize(title);
    // 歌手與歌名都要「互相包含」才算命中，避免查到同名但不同人的歌而給出錯誤年份
    const hit = (data.results ?? []).find((r) => {
      const a = normalize(r.artistName ?? '');
      const t = normalize(r.trackName ?? '');
      const artistOk = !wantArtist || a.includes(wantArtist) || wantArtist.includes(a);
      const titleOk = t && wantTitle && (wantTitle.includes(t) || t.includes(wantTitle));
      return artistOk && titleOk;
    });
    const year = hit?.releaseDate ? new Date(hit.releaseDate).getUTCFullYear() : undefined;
    const facts: Facts | null = hit ? { year: Number.isFinite(year) ? year : undefined, genre: hit.primaryGenreName } : null;
    factsCache.set(cacheKey, facts);
    return facts;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

function buildPrompt(items: SuggestItem[], facts: Map<string, Facts | null>, themes: SuggestTheme[]): string {
  return JSON.stringify({
    themes: themes.map((t) => ({ id: t.id, name: t.name, description: t.description })),
    songs: items.map((i) => {
      const f = facts.get(i.key);
      return { key: i.key, title: cleanTitle(i.title), artist: i.artist, releaseYear: f?.year ?? null, genre: f?.genre ?? null };
    }),
  });
}

const SYSTEM_PROMPT = `你是華語與國際流行音樂的資料標註員。使用者會給你一份「主題清單」(themes) 與一批歌曲 (songs)，
請判斷每首歌適合哪些主題。

規則：
1. 只能使用 themes 裡出現過的 id，不可自創主題或 id。
2. 依據歌名、歌手、releaseYear、genre 判斷；releaseYear 與 genre 是查證過的事實，優先採信。
   歌手性別、團體、語言、曲風、情境等，依你對該歌手與歌曲的確切知識判斷。
3. 沒有把握就不要選，寧可留空 themeIds 也不要亂猜。一首歌可以符合多個主題，也可以沒有任何主題。
4. reason 用 20 字以內說明主要依據，例如「2004 年・男歌手」。
5. 只輸出 JSON 陣列，不要任何其他文字：[{"key":"...","themeIds":["..."],"reason":"..."}]`;

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
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).map((c) => c.text ?? '').join('');
}

/** 從模型回覆中取出 JSON 陣列並過濾成合法結果（id 必須存在於主題清單、key 必須是請求過的） */
export function parseModelOutput(text: string, items: SuggestItem[], themes: SuggestTheme[]): SuggestResult[] {
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
  const out: SuggestResult[] = [];
  for (const row of parsed as { key?: unknown; themeIds?: unknown; reason?: unknown }[]) {
    if (typeof row?.key !== 'string' || !validKeys.has(row.key)) continue;
    const ids = Array.isArray(row.themeIds)
      ? Array.from(new Set((row.themeIds as unknown[]).filter((x): x is string => typeof x === 'string' && validThemes.has(x))))
      : [];
    out.push({ key: row.key, themeIds: ids, reason: typeof row.reason === 'string' ? row.reason.slice(0, 40) : '' });
  }
  return out;
}

export async function suggestThemes(items: SuggestItem[], themes: SuggestTheme[]): Promise<SuggestResponse> {
  const warnings: string[] = [];
  const facts = await lookupAllFacts(items);
  const factsFound = Array.from(facts.values()).filter((f) => f && (f.year || f.genre)).length;
  if (factsFound === 0 && items.length > 0) warnings.push('查不到任何年份／曲風資料，年代類主題的判斷會比較不準');

  if (process.env.ANTHROPIC_API_KEY) {
    const results = new Map<string, SuggestResult>();
    let aiFailed = false;
    for (let i = 0; i < items.length; i += AI_BATCH_SIZE) {
      const batch = items.slice(i, i + AI_BATCH_SIZE);
      try {
        const text = await callClaude(buildPrompt(batch, facts, themes));
        for (const r of parseModelOutput(text, batch, themes)) results.set(r.key, r);
      } catch (err) {
        aiFailed = true;
        console.error('[themeSuggest] Claude 呼叫失敗：', err);
      }
    }
    // 模型沒回的歌曲（失敗或漏掉）改用規則補上
    for (const item of items) {
      if (!results.has(item.key)) results.set(item.key, ruleSuggest(item, facts.get(item.key) ?? null, themes));
    }
    if (aiFailed) warnings.push('部分歌曲 AI 判斷失敗，已改用規則（年份／曲風）補上');
    return { results: items.map((i) => results.get(i.key)!), mode: aiFailed ? 'rules' : 'ai', factsFound, warnings };
  }

  warnings.push('伺服器未設定 ANTHROPIC_API_KEY，僅用年份／曲風規則判斷（無法判斷歌手性別、情境等語意類主題）');
  return {
    results: items.map((i) => ruleSuggest(i, facts.get(i.key) ?? null, themes)),
    mode: 'rules',
    factsFound,
    warnings,
  };
}
