import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';

// POST /api/rooms/:joinCode/join → 加入既有房間
export async function POST(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const body = await request.json();
    const { displayName } = body;
    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
      return NextResponse.json({ error: '請輸入暱稱' }, { status: 400 });
    }

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() }, include: { players: true } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間，請確認房號是否正確' }, { status: 404 });
    }
    if (room.status === 'finished') {
      return NextResponse.json({ error: '這場比賽已經結束' }, { status: 409 });
    }

    const trimmedName = displayName.trim();
    const nameTaken = room.players.some(
      (p: { displayName: string }) => p.displayName.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (nameTaken) {
      return NextResponse.json({ error: `「${trimmedName}」這個暱稱已經有人用了，換一個試試` }, { status: 409 });
    }

    const player = await prisma.roomPlayer.create({
      data: { id: crypto.randomUUID(), roomId: room.id, displayName: trimmedName },
    });

    const state = await loadRoomState(room.joinCode);
    return NextResponse.json({ room: state, playerId: player.id }, { status: 201 });
  } catch (err) {
    console.error(`[POST /api/rooms/${joinCode}/join] 加入房間失敗：`, err);
    return NextResponse.json({ error: '加入房間失敗' }, { status: 500 });
  }
}
