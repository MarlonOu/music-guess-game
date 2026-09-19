import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PUT /api/songs/:id → 更新指定歌曲，供 /admin 資料庫管理頁面使用
// themeIds 若有帶入，會整批覆蓋該歌曲的主題指派（先刪舊的關聯再依新清單建立）
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const {
      title,
      artistId,
      youtubeVideoId,
      appleMusicTrackId,
      appleMusicPreviewUrl,
      deezerTrackId,
      deezerPreviewUrl,
      durationSec,
      lyrics,
      themeIds,
    } = body;

    // 如果這次更新有觸碰到任一播放來源欄位，先確認更新後至少還有一種來源存在，
    // 避免不小心把三種來源都清空，讓這首歌變成沒辦法播放。
    if (youtubeVideoId !== undefined || appleMusicPreviewUrl !== undefined || deezerPreviewUrl !== undefined) {
      const existing = await prisma.song.findUnique({
        where: { id },
        select: { youtubeVideoId: true, appleMusicPreviewUrl: true, deezerPreviewUrl: true },
      });
      const resultingYoutube = youtubeVideoId !== undefined ? youtubeVideoId : existing?.youtubeVideoId;
      const resultingApple = appleMusicPreviewUrl !== undefined ? appleMusicPreviewUrl : existing?.appleMusicPreviewUrl;
      const resultingDeezer = deezerPreviewUrl !== undefined ? deezerPreviewUrl : existing?.deezerPreviewUrl;
      if (!resultingYoutube && !resultingApple && !resultingDeezer) {
        return NextResponse.json(
          { error: 'youtubeVideoId／appleMusicPreviewUrl／deezerPreviewUrl 至少要保留一個，不能三個都清空' },
          { status: 400 }
        );
      }
    }

    await prisma.song.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(artistId !== undefined ? { artistId } : {}),
        ...(youtubeVideoId !== undefined ? { youtubeVideoId: youtubeVideoId || null } : {}),
        ...(appleMusicTrackId !== undefined ? { appleMusicTrackId: appleMusicTrackId || null } : {}),
        ...(appleMusicPreviewUrl !== undefined ? { appleMusicPreviewUrl: appleMusicPreviewUrl || null } : {}),
        ...(deezerTrackId !== undefined ? { deezerTrackId: deezerTrackId || null } : {}),
        ...(deezerPreviewUrl !== undefined ? { deezerPreviewUrl: deezerPreviewUrl || null } : {}),
        ...(durationSec !== undefined ? { durationSec: Number(durationSec) } : {}),
        ...(lyrics !== undefined ? { lyrics } : {}),
        ...(Array.isArray(themeIds)
          ? {
              themes: {
                deleteMany: {},
                create: themeIds.map((themeId: string) => ({ themeId })),
              },
            }
          : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[PUT /api/songs/${id}] 更新失敗：`, err);
    return NextResponse.json({ error: '更新歌曲失敗' }, { status: 500 });
  }
}

// DELETE /api/songs/:id → 刪除指定歌曲
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.song.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[DELETE /api/songs/${id}] 刪除失敗：`, err);
    return NextResponse.json({ error: '刪除歌曲失敗' }, { status: 500 });
  }
}
