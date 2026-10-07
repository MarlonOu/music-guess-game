import { NextRequest, NextResponse } from 'next/server';
import { resolveDeezerPreview, unsealDeezerTrackId } from '../../../../../lib/server/deezerPreview';
import { allowRequest, getClientIp } from '../../../../../lib/server/rateLimit';

// GET /api/audio/deezer/:token → 轉址到這首 Deezer 曲目「當下有效」的試聽網址。
// token 是加密後的 track id（見 lib/server/deezerPreview.ts），所以網址本身不會洩漏歌曲身分。
// Deezer 的試聽網址帶有時效簽章，不能長期存在資料庫裡，所以每次播放時由這裡即時解析。
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!allowRequest(`deezer-audio:${getClientIp(request)}`, 600, 60_000)) {
    return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 });
  }
  const { token } = await params;
  const trackId = unsealDeezerTrackId(token);
  if (!trackId) return NextResponse.json({ error: '無效的音訊代碼' }, { status: 404 });
  const url = await resolveDeezerPreview(trackId);
  if (!url) return NextResponse.json({ error: 'Deezer 暫時查不到這首歌的試聽片段' }, { status: 502 });
  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'Cache-Control': 'private, max-age=60', 'Referrer-Policy': 'no-referrer' },
  });
}
