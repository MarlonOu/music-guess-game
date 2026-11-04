import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';
import { sanitizeDisplayName } from '../../../../../lib/server/sanitizeName';
import { rateLimitByIp, readJsonBody } from '../../../../../lib/server/requestGuards';

/** 單一房間人數上限，避免有人用腳本把同一間房塞滿假玩家、讓每次輪詢回應無限變大 */
const MAX_PLAYERS_PER_ROOM = 30;

// POST /api/rooms/:joinCode/join → 加入既有房間
export async function POST(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  // 每個 IP 每分鐘最多加入 20 次（含斷線後自動重新加入），正常遊玩遠低於此
  const limited = rateLimitByIp(request, 'room-join', 20, 60_000);
  if (limited) return limited;
  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const trimmedName = sanitizeDisplayName(parsed.body.displayName);
    if (!trimmedName) {
      return NextResponse.json({ error: '請輸入暱稱' }, { status: 400 });
    }

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() }, include: { players: true } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間，請確認房號是否正確' }, { status: 404 });
    }
    if (room.status === 'finished') {
      return NextResponse.json({ error: '這場比賽已經結束' }, { status: 409 });
    }

    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      return NextResponse.json({ error: `這個房間已滿（上限 ${MAX_PLAYERS_PER_ROOM} 人）` }, { status: 409 });
    }

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
