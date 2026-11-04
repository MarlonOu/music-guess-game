import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';
import { readJsonBody } from '../../../../../lib/server/requestGuards';
import { authenticatePlayer } from '../../../../../lib/server/playerAuth';

// POST /api/rooms/:joinCode/end → 房主提前結束比賽
export async function POST(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const { playerId } = body;

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間' }, { status: 404 });
    }
    // playerId 會出現在公開的房間狀態裡，必須附上本人的玩家憑證才算數（見 lib/server/playerAuth.ts）
    const auth = await authenticatePlayer(request, body, room.id);
    if (!auth.ok) return auth.response;
    if (room.hostPlayerId !== playerId) {
      return NextResponse.json({ error: '只有房主可以結束比賽' }, { status: 403 });
    }

    await prisma.room.update({ where: { id: room.id }, data: { status: 'finished' } });

    const state = await loadRoomState(room.joinCode);
    return NextResponse.json({ room: state });
  } catch (err) {
    console.error(`[POST /api/rooms/${joinCode}/end] 結束比賽失敗：`, err);
    return NextResponse.json({ error: '結束比賽失敗' }, { status: 500 });
  }
}
