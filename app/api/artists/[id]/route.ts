import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PUT /api/artists/:id → 更新指定歌手
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { name, gender } = body;

    await prisma.artist.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(gender !== undefined ? { gender } : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[PUT /api/artists/${id}] 更新失敗：`, err);
    return NextResponse.json({ error: '更新歌手失敗' }, { status: 500 });
  }
}

// DELETE /api/artists/:id → 刪除指定歌手
// 邊界條件：該歌手底下若仍有歌曲（外鍵約束），刪除會失敗，回傳明確錯誤訊息而非靜默失敗
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.artist.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[DELETE /api/artists/${id}] 刪除失敗：`, err);
    return NextResponse.json(
      { error: '刪除歌手失敗，請確認該歌手底下已無歌曲（需先刪除或轉移旗下歌曲）' },
      { status: 500 }
    );
  }
}
