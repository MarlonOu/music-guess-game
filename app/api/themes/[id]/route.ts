import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// DELETE /api/themes/:id → 刪除主題（連帶清除該主題與歌曲的關聯，song_themes 有 onDelete: Cascade）
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.theme.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[DELETE /api/themes/${id}] 刪除失敗：`, err);
    return NextResponse.json({ error: '刪除主題失敗' }, { status: 500 });
  }
}
