import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';

// POST /api/rooms/:joinCode/next → 房主推進到下一題（或若已是最後一題則結束比賽）
export async function POST(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const body = await request.json();
    const { playerId } = body;

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間' }, { status: 404 });
    }
    if (room.hostPlayerId !== playerId) {
      return NextResponse.json({ error: '只有房主可以控制題目進度' }, { status: 403 });
    }
    if (room.status !== 'playing') {
      return NextResponse.json({ error: '比賽尚未開始或已結束' }, { status: 409 });
    }

    const nextIndex = room.currentRoundIndex + 1;
    if (nextIndex >= room.songQueue.length) {
      await prisma.room.update({ where: { id: room.id }, data: { status: 'finished' } });
    } else {
      await prisma.room.update({
        where: { id: room.id },
        // 換題時重置投票跳題名單，新的一題大家要重新投
        data: { currentRoundIndex: nextIndex, revealed: false, roundStartedAt: new Date(), skipVotePlayerIds: [] },
      });
    }

    const state = await loadRoomState(room.joinCode);
    return NextResponse.json({ room: state });
  } catch (err) {
    console.error(`[POST /api/rooms/${joinCode}/next] 推進題目失敗：`, err);
    return NextResponse.json({ error: '推進題目失敗' }, { status: 500 });
  }
}
