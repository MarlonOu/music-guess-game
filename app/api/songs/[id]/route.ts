import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PUT /api/songs/:id → 更新指定歌曲，供 /admin 資料庫管理頁面使用
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { title, artistId, youtubeVideoId, durationSec, lyrics } = body;

    await prisma.song.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(artistId !== undefined ? { artistId } : {}),
        ...(youtubeVideoId !== undefined ? { youtubeVideoId } : {}),
        ...(durationSec !== undefined ? { durationSec: Number(durationSec) } : {}),
        ...(lyrics !== undefined ? { lyrics } : {}),
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
