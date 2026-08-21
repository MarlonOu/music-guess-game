import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';
import { advanceRoundAfterReveal } from '../../../../../lib/server/advanceRound';

// POST /api/rooms/:joinCode/vote-skip → 任一玩家投票／收回投票「跳過這一題」。
// 全房間玩家（含房主自己）都投了票，視為這題流局：伺服器立刻推進到下一題並排好開始時間
// （不計分，流程細節見 advanceRoundAfterReveal）。
export async function POST(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const body = await request.json();
    const { playerId } = body;
    if (!playerId) {
      return NextResponse.json({ error: '缺少必要欄位（playerId）' }, { status: 400 });
    }

    const room = await prisma.room.findUnique({
      where: { joinCode: joinCode.toUpperCase() },
      include: { players: true },
    });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間' }, { status: 404 });
    }
    const player = room.players.find((p: { id: string }) => p.id === playerId);
    if (!player) {
      return NextResponse.json({ error: '找不到這位玩家，可能已離開房間' }, { status: 404 });
    }
    if (room.status !== 'playing') {
      return NextResponse.json({ error: '比賽尚未開始或已結束' }, { status: 409 });
    }
    if (room.revealed) {
      // 答案已經公布（可能剛好有人同時答對，或票數剛好在這之前就已經到齊），直接回傳現況即可。
      const state = await loadRoomState(room.joinCode);
      return NextResponse.json({ room: state });
    }

    // 切換投票狀態：已投過就收回，沒投過就加入，讓玩家可以反悔。
    const alreadyVoted = room.skipVotePlayerIds.includes(playerId);
    const nextVotes = alreadyVoted
      ? room.skipVotePlayerIds.filter((id: string) => id !== playerId)
      : [...room.skipVotePlayerIds, playerId];

    // 全員到齊（人數以目前房間內實際玩家數為準，離開的人不計入分母，避免有人離開後永遠湊不齊）才流局公布。
    const allVoted = room.players.length > 0 && nextVotes.length >= room.players.length;

    await prisma.room.update({
      where: { id: room.id },
      data: { skipVotePlayerIds: nextVotes },
    });

    if (allVoted) {
      await advanceRoundAfterReveal(room.id, room.currentRoundIndex);
    }

    const state = await loadRoomState(room.joinCode);
    return NextResponse.json({ room: state });
  } catch (err) {
    console.error(`[POST /api/rooms/${joinCode}/vote-skip] 投票跳題失敗：`, err);
    return NextResponse.json({ error: '投票跳題失敗' }, { status: 500 });
  }
}
