import { NextRequest, NextResponse } from 'next/server';

interface AppleMusicSearchResult {
  trackId: string;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  durationSec: number;
  previewUrl: string;
}

// GET /api/apple-music-search?q=關鍵字&country=TW → 搜尋 iTunes 曲目，回傳可直接掛到歌曲上的
// 試聽網址與 track id，供 /admin 歌曲管理頁面搜尋輔助建檔使用。
// 不需要任何 API 金鑰——iTunes Search API 是公開、免驗證的服務，這點跟 YouTube 搜尋不同。
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ error: '缺少查詢關鍵字（q）' }, { status: 400 });
  }
  const country = request.nextUrl.searchParams.get('country')?.trim() || 'TW';

  try {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', q);
    url.searchParams.set('country', country);
    url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'song');
    url.searchParams.set('limit', '15');

    const res = await fetch(url);
    if (!res.ok) {
      console.error('[GET /api/apple-music-search] iTunes API 回應錯誤：', res.status);
      return NextResponse.json({ error: `Apple Music 搜尋失敗（HTTP ${res.status}）` }, { status: 502 });
    }
    const data = await res.json();

    const results: AppleMusicSearchResult[] = (data.results ?? [])
      // 極少數結果沒有 previewUrl（該地區商店下架、或版權限制），這種沒辦法用，直接濾掉
      .filter((r: { previewUrl?: string }) => Boolean(r.previewUrl))
      .map(
        (r: {
          trackId: number;
          trackName: string;
          artistName: string;
          artworkUrl100?: string;
          trackTimeMillis?: number;
          previewUrl: string;
        }) => ({
          trackId: String(r.trackId),
          trackName: r.trackName,
          artistName: r.artistName,
          artworkUrl: r.artworkUrl100 ?? '',
          durationSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
          previewUrl: r.previewUrl,
        })
      );

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[GET /api/apple-music-search] 查詢失敗：', err);
    return NextResponse.json({ error: 'Apple Music 搜尋失敗' }, { status: 500 });
  }
}
