import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';
import { advanceRoundAfterReveal } from '../../../../../lib/server/advanceRound';

// POST /api/rooms/:joinCode/answer-choice → 選擇題搶答模式（answerMode='choice'）下，
// 玩家點選其中一個選項（songId）。答對的判定與換題機制直接複用 advanceRoundAfterReveal，
// 跟打字搶答（messages route）共用同一套「答對當下立即原子性推進到下一題」的機制。
export async function POST(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const body = await request.json();
    const { playerId, songId } = body;
    if (!playerId || !songId) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間' }, { status: 404 });
    }
    if (room.answerMode !== 'choice') {
      return NextResponse.json({ error: '這個房間不是選擇題搶答模式' }, { status: 409 });
    }
    const player = await prisma.roomPlayer.findUnique({ where: { id: playerId } });
    if (!player || player.roomId !== room.id) {
      return NextResponse.json({ error: '找不到這位玩家，可能已離開房間' }, { status: 404 });
    }

    let correct = false;

    if (room.status === 'playing' && !room.revealed && room.songQueue[room.currentRoundIndex] === songId) {
      // advanceRoundAfterReveal 用樂觀鎖保護：只有「這次呼叫讀到的還是當下真正那一輪」
      // 才會真的觸發轉換（回傳 true）。避免兩個人幾乎同時點對答案時，兩邊都以為自己是
      // 第一個、都加分、都各自把房間推進一次（等於直接跳過一整題）。
      const advanced = await advanceRoundAfterReveal(room.id, room.currentRoundIndex);
      if (advanced) {
        correct = true;
        await prisma.roomPlayer.update({ where: { id: player.id }, data: { score: { increment: 1 } } });
      }
    }
    // 點錯的選項不記錄、不限制重試次數，效果跟打字搶答猜錯了可以再打一次一樣，
    // 保持兩種搶答方式的行為一致，不因為換了互動形式而多出額外的限制。

    const state = await loadRoomState(room.joinCode);
    return NextResponse.json({ correct, room: state });
  } catch (err) {
    console.error(`[POST /api/rooms/${joinCode}/answer-choice] 搶答失敗：`, err);
    return NextResponse.json({ error: '搶答失敗' }, { status: 500 });
  }
}
