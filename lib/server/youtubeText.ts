/** YouTube 影片／頻道文字處理共用函式（播放清單匯入與玩家投稿共用）。 */

// 顯示語言：YouTube 網站依觀看者語言顯示影片／頻道的「在地化」標題，但 playlistItems.list 回傳的
// snippet.title 永遠是上傳者設定的預設語言（常常是英文），所以網站上看到中文、匯入後卻變英文。
// 改由 videos.list／channels.list 以 hl 取得在地化版本，找不到才退回預設標題。
export const DISPLAY_LANGUAGE = 'zh-TW';
const LOCALIZATION_KEYS = ['zh-TW', 'zh-Hant-TW', 'zh-Hant', 'zh-HK', 'zh-Hant-HK', 'zh'];

export function pickLocalized(
  localizations: Record<string, { title?: string }> | undefined,
  hlTitle: string | undefined
): string | undefined {
  // 有明確的繁中在地化資料時優先採用；hl 回傳的 snippet.localized 若沒有對應語言會回到預設語言，
  // 因此只當後備。簡體（zh-CN／zh-Hans）排在最後，總比純英文／拼音有用，管理者仍可手動修改。
  for (const key of LOCALIZATION_KEYS) {
    const t = localizations?.[key]?.title?.trim();
    if (t) return t;
  }
  const other = Object.keys(localizations ?? {}).find((k) => /^zh/i.test(k) && localizations?.[k]?.title?.trim());
  if (other) return localizations![other].title!.trim();
  return hlTitle?.trim() || undefined;
}

/** 去掉 YouTube 自動產生的藝人頻道後綴：英文「 - Topic」，在地化後會變成「 - 主題／主题」 */
export function stripTopicSuffix(name: string): string {
  return name.replace(/\s*[-–—]\s*(topic|主題|主题)\s*$/i, '').trim();
}

export const HAS_CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

/**
 * 自動產生的 Topic 影片，標題與頻道常是羅馬拼音／英文（"Shuo Ai Ni"、"Jolin Tsai"），
 * 但 YouTube 網站上看到的是中文。API 取不到時，用 iTunes（台灣商店）以影片長度當驗證：
 * 藝人 Topic 影片的長度就是該曲目長度，與 iTunes 結果相差 3 秒內且名稱含中文才採用，
 * 避免把不同版本或同名歌曲的資料套錯。查不到就維持原樣。
 */
export async function lookupChineseNames(
  artist: string,
  title: string,
  durationSec: number
): Promise<{ title: string; artist: string } | null> {
  if (durationSec <= 0 || (HAS_CJK.test(title) && HAS_CJK.test(artist))) return null;
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const res = await fetch(`https://itunes.apple.com/search?term=${term}&country=TW&media=music&entity=song&limit=8`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: { trackName?: string; artistName?: string; trackTimeMillis?: number }[] };
    const hit = (data.results ?? []).find(
      (r) =>
        r.trackName &&
        r.artistName &&
        HAS_CJK.test(r.trackName) &&
        typeof r.trackTimeMillis === 'number' &&
        Math.abs(r.trackTimeMillis / 1000 - durationSec) <= 3
    );
    if (!hit) return null;
    return { title: hit.trackName!.trim(), artist: hit.artistName!.replace(/\s*[（(].*[）)]\s*$/, '').trim() };
  } catch {
    return null;
  }
}

/** 解析 YouTube API 回傳的 ISO 8601 時長格式（例如 PT4M13S）為總秒數 */
export function parseIso8601Duration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

