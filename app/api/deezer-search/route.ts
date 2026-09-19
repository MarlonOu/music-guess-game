import { NextRequest, NextResponse } from 'next/server';

interface DeezerSearchResult {
  trackId: string;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  durationSec: number;
  previewUrl: string;
}

// GET /api/deezer-search?q=關鍵字 → 搜尋 Deezer 曲目，回傳可直接掛到歌曲上的試聽網址與 track id，
// 供 /admin 歌曲管理頁面搜尋輔助建檔使用。這是 Apple Music 目錄沒收錄這首歌時的第二層備援
// （見 lib/audio/resolvePlaybackTarget.ts 的優先序說明）。
// 不需要任何 API 金鑰——Deezer Search API 是公開、免驗證的服務，跟 iTunes Search API 同類型。
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ error: '缺少查詢關鍵字（q）' }, { status: 400 });
  }

  try {
    const url = new URL('https://api.deezer.com/search');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '15');

    const res = await fetch(url);
    if (!res.ok) {
      console.error('[GET /api/deezer-search] Deezer API 回應錯誤：', res.status);
      return NextResponse.json({ error: `Deezer 搜尋失敗（HTTP ${res.status}）` }, { status: 502 });
    }
    const data = await res.json();

    // Deezer 對查詢頻率過高或參數異常時，回應本身仍是 200 但帶一個 error 物件，不是走 HTTP 錯誤碼，
    // 這裡額外檢查一次，避免把這種情況誤判成「查無結果」而不是「查詢失敗」。
    if (data.error) {
      console.error('[GET /api/deezer-search] Deezer API 回傳錯誤內容：', data.error);
      return NextResponse.json({ error: 'Deezer 搜尋失敗，請稍後再試' }, { status: 502 });
    }

    const results: DeezerSearchResult[] = (data.data ?? [])
      // 少數結果沒有 preview（版權限制或尚未處理試聽檔），這種沒辦法用，直接濾掉
      .filter((r: { preview?: string }) => Boolean(r.preview))
      .map(
        (r: {
          id: number;
          title: string;
          artist?: { name?: string };
          album?: { cover_medium?: string };
          duration?: number;
          preview: string;
        }) => ({
          trackId: String(r.id),
          trackName: r.title,
          artistName: r.artist?.name ?? '',
          artworkUrl: r.album?.cover_medium ?? '',
          // Deezer 的 duration 本來就是秒數（不像 iTunes 是毫秒），不需要額外換算
          durationSec: r.duration ?? 0,
          previewUrl: r.preview,
        })
      );

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[GET /api/deezer-search] 查詢失敗：', err);
    return NextResponse.json({ error: 'Deezer 搜尋失敗' }, { status: 500 });
  }
}
