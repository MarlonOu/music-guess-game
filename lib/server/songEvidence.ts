/**
 * 歌曲佐證資料蒐集（自動判斷主題用）。
 *
 * 模型只靠記憶判斷「KTV 必唱」「經典必聽」「抖音神曲」這類主觀主題容易誤判，所以先去查公開資料，
 * 把查到的內容當作「佐證」一起交給模型，並要求主觀主題必須引用佐證才能選：
 * - 維基百科（zh.wikipedia.org 官方 API）：歌曲／專輯條目的簡介，常含發行年份、獲獎、榜單、爆紅經過。
 * - Google 新聞 RSS（官方提供的搜尋 RSS，台灣繁中）：只取「標題與來源」，不抓文章全文——
 *   標題足以看出獲獎／爆紅／翻唱等事件，也避免大量抓取文章內容的著作權與技術問題（付費牆、robots）。
 *
 * 所有查詢都有逾時、失敗就當作沒有佐證，不影響其他判斷；結果在記憶體快取，同一首歌短時間內不重複查。
 * 佐證是「資料」不是指令：交給模型時會明確標示，內容裡出現的任何要求都不得照做。
 */

export interface Evidence {
  /** 維基百科條目簡介（已截斷），沒有就是 null */
  wikipedia: string | null;
  /** 新聞標題（含來源），最多 5 則 */
  headlines: string[];
}

const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'music-guess-game-admin/1.0 (theme suggestion; contact: site admin)';
const cache = new Map<string, { at: number; value: Evidence }>();

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s -¿ -⁯　-〿!-/:-@[-`{-~]/g, '');
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': USER_AGENT } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function fetchWikipedia(title: string, artist: string): Promise<string | null> {
  const q = encodeURIComponent(`${title} ${artist}`);
  const url =
    `https://zh.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrlimit=4` +
    `&prop=extracts&exintro=1&explaintext=1&exchars=500&redirects=1&format=json&formatversion=2&uselang=zh-tw`;
  const text = await getText(url);
  if (!text) return null;
  try {
    const data = JSON.parse(text) as { query?: { pages?: { title?: string; index?: number; extract?: string }[] } };
    const pages = (data.query?.pages ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const wantTitle = normalize(title);
    const wantArtist = normalize(artist);
    // 條目必須同時提到歌名與歌手才採用，避免同名歌曲或不相干條目混進來
    const hit = pages.find((p) => {
      const body = normalize(`${p.title ?? ''}${p.extract ?? ''}`);
      return p.extract && wantTitle && body.includes(wantTitle) && (!wantArtist || body.includes(wantArtist));
    });
    return hit?.extract ? `《${hit.title}》${hit.extract.replace(/\s+/g, ' ').trim()}` : null;
  } catch {
    return null;
  }
}

async function fetchHeadlines(title: string, artist: string): Promise<string[]> {
  const q = encodeURIComponent(`"${title}" ${artist}`);
  const xml = await getText(`https://news.google.com/rss/search?q=${q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`);
  if (!xml) return [];
  const wantTitle = normalize(title);
  const wantArtist = normalize(artist);
  const out: string[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const raw = /<title>([\s\S]*?)<\/title>/.exec(m[1])?.[1] ?? '';
    const headline = raw
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    const n = normalize(headline);
    // 標題要提到歌名或歌手才算相關（搜尋引擎會回傳很多只有部分關鍵字的雜訊）
    if (headline && ((wantTitle && n.includes(wantTitle)) || (wantArtist && n.includes(wantArtist)))) out.push(headline.slice(0, 120));
    if (out.length >= 5) break;
  }
  return out;
}

export async function gatherEvidence(title: string, artist: string): Promise<Evidence> {
  const key = `${normalize(artist)}|${normalize(title)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const [wikipedia, headlines] = await Promise.all([fetchWikipedia(title, artist), fetchHeadlines(title, artist)]);
  const value: Evidence = { wikipedia, headlines };
  // 兩邊都查不到可能只是暫時失敗，不快取，下次仍可重試
  if (wikipedia || headlines.length > 0) cache.set(key, { at: Date.now(), value });
  return value;
}

/** 以固定並行數蒐集多首歌的佐證 */
export async function gatherAllEvidence(
  items: { key: string; title: string; artist: string }[],
  concurrency = 4
): Promise<Map<string, Evidence>> {
  const out = new Map<string, Evidence>();
  const queue = [...items];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        out.set(item.key, await gatherEvidence(item.title, item.artist));
      }
    })
  );
  return out;
}
