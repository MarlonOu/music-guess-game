import { NextRequest, NextResponse } from 'next/server';

interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSec: number;
  /** YouTube 官方回報的嵌入播放許可狀態；false 代表擁有者已關閉外部嵌入播放（會導致遊戲內無聲），管理頁面需明確標示 */
  embeddable: boolean;
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

// GET /api/youtube-search?q=關鍵字&pageToken=... → 呼叫 YouTube Data API v3 search.list + videos.list，
// 回傳前幾筆結果（含影片長度與是否允許嵌入播放，供管理頁面判斷；「前奏秒數」仍需人工聽過填寫，API 無法判斷）。
// pageToken 用於載入下一頁結果（回應中的 nextPageToken）。
// 金鑰（YOUTUBE_API_KEY）只在伺服器端使用，不會傳到瀏覽器。
// 配額成本：每次呼叫（含載入更多）search.list 100 units + videos.list 1 units ＝ 101 units。
export async function GET(request: NextRequest) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: '伺服器未設定 YOUTUBE_API_KEY，請參考 .env.example 設定後重啟伺服器' },
      { status: 500 }
    );
  }

  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ error: '缺少查詢關鍵字（q）' }, { status: 400 });
  }
  const pageToken = request.nextUrl.searchParams.get('pageToken') ?? undefined;

  try {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '8');
    searchUrl.searchParams.set('q', q);
    // videoCategoryId=10 為 YouTube 官方「音樂」分類，用來把結果限縮在音樂內容。
    // 這是公開 Data API 能做到的極限：YouTube Music 本身沒有對外開放的搜尋 API，
    // 無法做到「只搜尋 YouTube Music」，此為最接近的近似做法。
    searchUrl.searchParams.set('videoCategoryId', '10');
    if (pageToken) searchUrl.searchParams.set('pageToken', pageToken);
    searchUrl.searchParams.set('key', apiKey);

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      const body = await searchRes.text();
      console.error('[GET /api/youtube-search] YouTube search API 錯誤：', searchRes.status, body);
      return NextResponse.json({ error: `YouTube API 回應錯誤（HTTP ${searchRes.status}）` }, { status: 502 });
    }

    const searchData = await searchRes.json();
    const items: { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails?: { default?: { url: string } } } }[] =
      searchData.items ?? [];
    const videoIds = items.map((item) => item.id.videoId).filter(Boolean);

    // 批次查詢影片長度與嵌入許可狀態：videos.list 支援一次帶入多個 id（逗號分隔），固定消耗 1 units，不隨數量增加
    const durationById = new Map<string, number>();
    const embeddableById = new Map<string, boolean>();
    if (videoIds.length > 0) {
      const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      videosUrl.searchParams.set('part', 'contentDetails,status');
      videosUrl.searchParams.set('id', videoIds.join(','));
      videosUrl.searchParams.set('key', apiKey);

      const videosRes = await fetch(videosUrl);
      if (videosRes.ok) {
        const videosData = await videosRes.json();
        for (const v of videosData.items ?? []) {
          durationById.set(v.id, parseIso8601Duration(v.contentDetails?.duration ?? ''));
          // status.embeddable 缺席時（少數情況）預設視為可嵌入，避免誤擋，實際結果仍以遊戲內實測為準
          embeddableById.set(v.id, v.status?.embeddable ?? true);
        }
      } else {
        // 長度／嵌入狀態查詢失敗不阻斷整體搜尋結果，僅缺少對應資訊（前端保留手動輸入／不顯示警示）
        console.error('[GET /api/youtube-search] videos.list 查詢長度/嵌入狀態失敗：', videosRes.status);
      }
    }

    const results: YouTubeSearchResult[] = items
      // 少數情況下 YouTube 會回傳缺少 videoId 的非標準項目（例如已下架的結果），
      // 過濾掉這種資料，避免前端清單出現無法辨識、key 也無法保證唯一的項目
      .filter((item) => Boolean(item.id?.videoId))
      .map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnailUrl: item.snippet.thumbnails?.default?.url ?? '',
        durationSec: durationById.get(item.id.videoId) ?? 0,
        embeddable: embeddableById.get(item.id.videoId) ?? true,
      }));

    return NextResponse.json({ results, nextPageToken: searchData.nextPageToken ?? null });
  } catch (err) {
    console.error('[GET /api/youtube-search] 查詢失敗：', err);
    return NextResponse.json({ error: 'YouTube 搜尋失敗' }, { status: 500 });
  }
}
