import { NextRequest, NextResponse } from 'next/server';

interface PlaylistSongResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSec: number;
  embeddable: boolean;
  /** 私人／已刪除的影片會留在播放清單裡但沒有實際內容，title 會是 "Private video" 之類的固定字串，
   *  管理頁面需要明確標示、預設不勾選，避免誤匯入沒有內容的項目 */
  unavailable: boolean;
}

// 安全上限：避免單次貼一個超大播放清單（例如上千首）打爆 YouTube API 配額或讓請求跑太久。
// playlistItems.list 每頁最多 50 筆，6 頁 = 300 首，對一般題庫用途已經很足夠。
const MAX_PAGES = 6;
const PAGE_SIZE = 50;

/** 從播放清單網址或裸 ID 解析出 playlistId。支援：
 *  https://www.youtube.com/playlist?list=PLxxxx
 *  https://www.youtube.com/watch?v=xxx&list=PLxxxx
 *  裸的 PLxxxx（使用者直接貼 ID）
 */
function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const listParam = url.searchParams.get('list');
    if (listParam) return listParam;
  } catch {
    // 不是合法網址，當作裸 ID 處理，往下走
  }
  // 播放清單 ID 慣例以 PL / UU / LL / FL 開頭，簡單防呆避免把任意文字當 ID 送出去查詢
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

// 顯示語言：YouTube 網站依觀看者語言顯示影片／頻道的「在地化」標題，但 playlistItems.list 回傳的
// snippet.title 永遠是上傳者設定的預設語言（常常是英文），所以網站上看到中文、匯入後卻變英文。
// 改由 videos.list／channels.list 以 hl 取得在地化版本，找不到才退回預設標題。
const DISPLAY_LANGUAGE = 'zh-TW';
const LOCALIZATION_KEYS = ['zh-TW', 'zh-Hant', 'zh-HK', 'zh'];

function pickLocalized(
  localizations: Record<string, { title?: string }> | undefined,
  hlTitle: string | undefined
): string | undefined {
  // 有明確的繁中在地化資料時優先採用；hl 回傳的 snippet.localized 若沒有對應語言會回到預設語言，
  // 因此只當第二順位
  for (const key of LOCALIZATION_KEYS) {
    const t = localizations?.[key]?.title?.trim();
    if (t) return t;
  }
  return hlTitle?.trim() || undefined;
}

/** 解析 YouTube API 回傳的 ISO 8601 時長格式（例如 PT4M13S）為總秒數 */
function parseIso8601Duration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

// GET /api/youtube-playlist?url=播放清單網址或ID → 讀取整個播放清單（最多 MAX_PAGES 頁），
// 回傳每支影片的標題、頻道、長度、是否可嵌入播放，供管理頁面批次勾選匯入。
// 配額成本：playlistItems.list 每頁 1 units（最多 MAX_PAGES units）+ videos.list 每 50 個 id 1 units，
// 對一般題庫規模的播放清單成本很低（遠低於 youtube-search 的 search.list 100 units/次）。
export async function GET(request: NextRequest) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: '伺服器未設定 YOUTUBE_API_KEY，請參考 .env.example 設定後重啟伺服器' },
      { status: 500 }
    );
  }

  const rawUrl = request.nextUrl.searchParams.get('url')?.trim();
  if (!rawUrl) {
    return NextResponse.json({ error: '缺少播放清單網址（url）' }, { status: 400 });
  }
  const playlistId = extractPlaylistId(rawUrl);
  if (!playlistId) {
    return NextResponse.json({ error: '無法識別這個播放清單網址，請確認網址是否正確' }, { status: 400 });
  }

  try {
    type PlaylistItem = {
      videoId: string;
      title: string;
      channelTitle: string;
      thumbnailUrl: string;
      channelId: string;
    };
    const items: PlaylistItem[] = [];
    let pageToken: string | undefined;
    let pagesFetched = 0;
    let totalResults = 0;

    do {
      const listUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      listUrl.searchParams.set('part', 'snippet');
      listUrl.searchParams.set('playlistId', playlistId);
      listUrl.searchParams.set('maxResults', String(PAGE_SIZE));
      if (pageToken) listUrl.searchParams.set('pageToken', pageToken);
      listUrl.searchParams.set('key', apiKey);

      const res = await fetch(listUrl);
      if (!res.ok) {
        const body = await res.text();
        console.error('[GET /api/youtube-playlist] playlistItems.list 錯誤：', res.status, body);
        if (res.status === 404) {
          return NextResponse.json({ error: '找不到這個播放清單，請確認網址正確、且清單為公開或未列出狀態' }, { status: 404 });
        }
        return NextResponse.json({ error: `YouTube API 回應錯誤（HTTP ${res.status}）` }, { status: 502 });
      }

      const data = await res.json();
      totalResults = data.pageInfo?.totalResults ?? totalResults;
      for (const item of data.items ?? []) {
        const videoId: string | undefined = item.snippet?.resourceId?.videoId;
        if (!videoId) continue;
        items.push({
          videoId,
          title: item.snippet?.title ?? '',
          // videoOwnerChannelTitle 是影片本身上傳者的頻道名稱；若缺席（極少數情況）退回播放清單擁有者的頻道名稱
          channelTitle: item.snippet?.videoOwnerChannelTitle ?? item.snippet?.channelTitle ?? '',
          thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? '',
          channelId: item.snippet?.videoOwnerChannelId ?? '',
        });
      }
      pageToken = data.nextPageToken;
      pagesFetched += 1;
    } while (pageToken && pagesFetched < MAX_PAGES);

    // 批次查詢每支影片的長度、嵌入許可、可用狀態。videos.list 一次最多帶 50 個 id，
    // 逐批查詢（items 已經是 playlistItems.list 每頁 50 筆的自然分批，直接沿用同樣的批次大小）。
    const durationById = new Map<string, number>();
    const embeddableById = new Map<string, boolean>();
    const unavailableById = new Map<string, boolean>();
    const localizedTitleById = new Map<string, string>();
    for (let i = 0; i < items.length; i += PAGE_SIZE) {
      const batch = items.slice(i, i + PAGE_SIZE);
      const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      videosUrl.searchParams.set('part', 'contentDetails,status,snippet,localizations');
      videosUrl.searchParams.set('hl', DISPLAY_LANGUAGE);
      videosUrl.searchParams.set('id', batch.map((b) => b.videoId).join(','));
      videosUrl.searchParams.set('key', apiKey);

      const videosRes = await fetch(videosUrl);
      if (!videosRes.ok) {
        console.error('[GET /api/youtube-playlist] videos.list 查詢長度/狀態失敗：', videosRes.status);
        continue; // 這批查不到長度/狀態不阻斷整體結果，前端會顯示缺少長度、需要手動確認
      }
      const videosData = await videosRes.json();
      const returnedIds = new Set<string>();
      for (const v of videosData.items ?? []) {
        returnedIds.add(v.id);
        durationById.set(v.id, parseIso8601Duration(v.contentDetails?.duration ?? ''));
        embeddableById.set(v.id, v.status?.embeddable ?? true);
        const localized = pickLocalized(v.localizations, v.snippet?.localized?.title);
        if (localized) localizedTitleById.set(v.id, localized);
      }
      // videos.list 對已刪除／私人影片不會回傳對應項目（不是回傳錯誤，是該筆直接消失於結果中），
      // 沒在 returnedIds 裡出現的，視為不可用（對應 playlistItems.list 那邊看到的 "Private video" 之類項目）
      for (const b of batch) {
        if (!returnedIds.has(b.videoId)) unavailableById.set(b.videoId, true);
      }
    }

    // 頻道名稱同樣取繁體中文在地化名稱（例如頻道在英文介面叫 "JVR Music"，中文介面叫「杰威爾音樂」）
    const channelNameById = new Map<string, string>();
    const channelIds = Array.from(new Set(items.map((i) => i.channelId).filter(Boolean)));
    for (let i = 0; i < channelIds.length; i += PAGE_SIZE) {
      const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
      channelsUrl.searchParams.set('part', 'snippet,localizations');
      channelsUrl.searchParams.set('hl', DISPLAY_LANGUAGE);
      channelsUrl.searchParams.set('id', channelIds.slice(i, i + PAGE_SIZE).join(','));
      channelsUrl.searchParams.set('key', apiKey);
      const channelsRes = await fetch(channelsUrl);
      if (!channelsRes.ok) {
        console.error('[GET /api/youtube-playlist] channels.list 查詢在地化名稱失敗：', channelsRes.status);
        continue; // 查不到就沿用播放清單回傳的原始頻道名稱
      }
      const channelsData = await channelsRes.json();
      for (const c of channelsData.items ?? []) {
        const name = pickLocalized(c.localizations, c.snippet?.localized?.title);
        if (name) channelNameById.set(c.id, name);
      }
    }

    const results: PlaylistSongResult[] = items.map((item) => ({
      videoId: item.videoId,
      title: localizedTitleById.get(item.videoId) ?? item.title,
      // YouTube 自動產生的藝人頻道名稱帶有「 - Topic」後綴，不是歌手名稱本身，匯入時要去掉
      channelTitle: (channelNameById.get(item.channelId) ?? item.channelTitle).replace(/\s*[-–—]\s*topic$/i, '').trim(),
      thumbnailUrl: item.thumbnailUrl,
      durationSec: durationById.get(item.videoId) ?? 0,
      embeddable: embeddableById.get(item.videoId) ?? true,
      unavailable: unavailableById.get(item.videoId) ?? (item.title === 'Private video' || item.title === 'Deleted video'),
    }));

    return NextResponse.json({
      results,
      totalResults,
      truncated: Boolean(pageToken), // 還有下一頁但已達 MAX_PAGES 上限，代表清單比抓到的還長
    });
  } catch (err) {
    console.error('[GET /api/youtube-playlist] 讀取播放清單失敗：', err);
    return NextResponse.json({ error: '讀取播放清單失敗' }, { status: 500 });
  }
}
