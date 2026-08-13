import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';

// PATCH /api/rooms/:joinCode/settings → 房主更新模式／歌手篩選／主題篩選（只能在 lobby 狀態下修改）
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const body = await request.json();
    const { playerId, mode, artistFilterIds, themeFilterIds } = body;

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間' }, { status: 404 });
    }
    if (room.hostPlayerId !== playerId) {
      return NextResponse.json({ error: '只有房主可以修改遊戲設定' }, { status: 403 });
    }
    if (room.status !== 'lobby') {
      return NextResponse.json({ error: '比賽進行中無法修改設定' }, { status: 409 });
    }

    await prisma.room.update({
      where: { id: room.id },
      data: {
        ...(mode !== undefined ? { mode } : {}),
        ...(Array.isArray(artistFilterIds) ? { artistFilterIds } : {}),
        ...(Array.isArray(themeFilterIds) ? { themeFilterIds } : {}),
      },
    });

    const state = await loadRoomState(room.joinCode);
    return NextResponse.json({ room: state });
  } catch (err) {
    console.error(`[PATCH /api/rooms/${joinCode}/settings] 更新設定失敗：`, err);
    return NextResponse.json({ error: '更新設定失敗' }, { status: 500 });
  }
}
