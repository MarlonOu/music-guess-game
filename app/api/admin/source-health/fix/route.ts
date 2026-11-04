import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { matchSource } from '../../../../../lib/server/sourceMatch';

// POST /api/admin/source-health/fix  { songId, platform, action: 'refresh' | 'remove' }
// 健康檢查發現問題後的修復動作：
// - refresh（Apple／Deezer）：用既有 track id 查詢最新試聽網址並寫入（id 鎖定同一首歌，不重新比對）。
// - remove：移除該平台的來源欄位；移除後若三種來源都沒了則拒絕（歌曲將無法播放，請改為刪除歌曲或先補其他來源）。
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { songId?: unknown; platform?: unknown; action?: unknown };
  const { songId, platform, action } = body;
  if (typeof songId !== 'string' || !songId) return NextResponse.json({ error: '缺少 songId' }, { status: 400 });
  if (platform !== 'youtube' && platform !== 'apple' && platform !== 'deezer') {
    return NextResponse.json({ error: 'platform 不正確' }, { status: 400 });
  }
  if (action !== 'refresh' && action !== 'remove') return NextResponse.json({ error: 'action 不正確' }, { status: 400 });

  const song = await prisma.song.findUnique({
    where: { id: songId },
    select: {
      id: true,
      title: true,
      youtubeVideoId: true,
      appleMusicPreviewUrl: true,
      deezerPreviewUrl: true,
      appleMusicTrackId: true,
      deezerTrackId: true,
      artist: { select: { name: true } },
    },
  });
  if (!song) return NextResponse.json({ error: '找不到這首歌' }, { status: 404 });

  try {
    if (action === 'refresh') {
      if (platform === 'youtube') return NextResponse.json({ error: 'YouTube 來源無法刷新，請移除後重新指定' }, { status: 400 });
      const trackId = platform === 'apple' ? song.appleMusicTrackId : song.deezerTrackId;
      if (!trackId) return NextResponse.json({ error: '這首歌沒有 track id，無法刷新' }, { status: 400 });
      const result = await matchSource({ platform, mode: 'refresh', title: song.title, artist: song.artist.name, trackId });
      if (result.status !== 'refreshed') {
        const msg = result.status === 'notfound' ? result.note ?? '查不到這個曲目，可能已下架' : result.status === 'error' ? result.error : '刷新失敗';
        return NextResponse.json({ error: msg }, { status: 422 });
      }
      await prisma.song.update({
        where: { id: song.id },
        data: platform === 'apple' ? { appleMusicPreviewUrl: result.candidate.previewUrl } : { deezerPreviewUrl: result.candidate.previewUrl },
      });
      return NextResponse.json({ ok: true });
    }

    // remove：先確認移除後至少還有一種可播放來源
    const remaining = {
      youtube: platform === 'youtube' ? false : Boolean(song.youtubeVideoId),
      apple: platform === 'apple' ? false : Boolean(song.appleMusicPreviewUrl),
      deezer: platform === 'deezer' ? false : Boolean(song.deezerPreviewUrl || song.deezerTrackId),
    };
    if (!remaining.youtube && !remaining.apple && !remaining.deezer) {
      return NextResponse.json({ error: '這是這首歌最後一個來源，移除後無法播放。請先補上其他來源，或直接刪除這首歌' }, { status: 409 });
    }
    await prisma.song.update({
      where: { id: song.id },
      data:
        platform === 'youtube'
          ? { youtubeVideoId: null }
          : platform === 'apple'
            ? { appleMusicTrackId: null, appleMusicPreviewUrl: null, appleMusicVerified: false }
            : { deezerTrackId: null, deezerPreviewUrl: null, deezerVerified: false },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/admin/source-health/fix] 失敗：', err);
    return NextResponse.json({ error: '修復失敗' }, { status: 500 });
  }
}
