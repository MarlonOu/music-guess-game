import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PUT /api/themes/:id → 更新指定主題（名稱／說明）
// 跟 DELETE 不一樣，更新不會動到跟歌曲的關聯，單純改這個主題自己的名稱/說明文字，
// 所有已經指派這個主題的歌曲維持不變——這是補上這個路由的理由：先前只能刪除重建，
// 刪除會連帶清掉所有歌曲跟這個主題的關聯（onDelete: Cascade），只是想把名字改對
// 卻會意外讓所有歌曲失去這個主題，兩者影響範圍差很多。
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { name, description } = body;

    await prisma.theme.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[PUT /api/themes/${id}] 更新失敗：`, err);
    return NextResponse.json({ error: '更新主題失敗' }, { status: 500 });
  }
}

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
