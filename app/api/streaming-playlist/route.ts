import { NextRequest, NextResponse } from 'next/server';
import { allowRequest, getClientIp } from '../../../lib/server/rateLimit';
import { fetchStreamingPlaylist, StreamingPlaylistError, type StreamingPlatform } from '../../../lib/server/streamingPlaylist';

// GET /api/streaming-playlist?platform=kkbox|spotify&url=歌單網址
// 管理用（proxy.ts 要求管理者驗證）：讀取串流平台公開歌單的歌名與歌手。
export async function GET(request: NextRequest) {
  if (!allowRequest(`streaming-playlist:${getClientIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 });
  }
  const platform = request.nextUrl.searchParams.get('platform');
  const url = request.nextUrl.searchParams.get('url')?.trim() ?? '';
  if (platform !== 'kkbox' && platform !== 'spotify') {
    return NextResponse.json({ error: '請選擇 KKBOX 或 Spotify' }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: '缺少歌單網址' }, { status: 400 });
  try {
    const playlist = await fetchStreamingPlaylist(platform as StreamingPlatform, url);
    return NextResponse.json(playlist);
  } catch (err) {
    if (err instanceof StreamingPlaylistError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[GET /api/streaming-playlist] 失敗：', err);
    return NextResponse.json({ error: '讀取歌單失敗' }, { status: 500 });
  }
}
