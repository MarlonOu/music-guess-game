import { NextRequest, NextResponse } from 'next/server';
import { getStreakClipRequest } from '../../../../lib/server/streakSession';
import { resolveDeezerPreview } from '../../../../lib/server/deezerPreview';
import { clipPreview } from '../../../../lib/server/audioClip';
import { allowRequest, getClientIp } from '../../../../lib/server/rateLimit';

// GET /api/streak/audio?t=token&q=題號&k=apple|deezer&s=段落 → 回傳「目前解鎖的這一段」的音訊（mp3）。
// 伺服器端裁切：客戶端拿到的檔案長度就是這一段的長度，無法靠改前端多聽；
// 也不會看到 Apple／Deezer 的原始試聽網址。只放行目前進行中題目的目前段落。
export async function GET(request: NextRequest) {
  if (!allowRequest(`streak-audio:${getClientIp(request)}`, 120, 60_000)) {
    return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 });
  }
  const sp = request.nextUrl.searchParams;
  const token = sp.get('t') ?? '';
  const clip = getStreakClipRequest(token, Number(sp.get('q')), sp.get('k') ?? '', Number(sp.get('s')));
  if (!clip) {
    return NextResponse.json({ error: '這一段音訊已失效' }, { status: 404 });
  }
  // Deezer 的網址會過期：有 track id 就即時取最新網址，查不到才退回資料庫存的舊網址
  const url = clip.deezerTrackId ? ((await resolveDeezerPreview(clip.deezerTrackId)) ?? clip.url) : clip.url;
  const audio = await clipPreview(clip.cacheKey, url, clip.startSec, clip.durationSec);
  if (!audio) {
    return NextResponse.json({ error: '音訊處理失敗' }, { status: 502 });
  }
  return new NextResponse(new Uint8Array(audio), {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.length),
      'Cache-Control': 'no-store',
    },
  });
}
