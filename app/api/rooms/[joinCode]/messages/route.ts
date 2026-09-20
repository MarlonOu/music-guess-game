import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { isAnswerCorrect } from '../../../../../lib/engine/answerUtils';
import { advanceRoundAfterReveal } from '../../../../../lib/server/advanceRound';
import type { RoomMessage } from '../../../../../lib/types/room';

function toMessage(row: {
  id: string;
  playerId: string;
  displayName: string;
  text: string;
  isCorrectAnswer: boolean;
  roundIndex: number | null;
  createdAt: Date;
}): RoomMessage {
  return {
    id: row.id,
    playerId: row.playerId,
    displayName: row.displayName,
    text: row.text,
    isCorrectAnswer: row.isCorrectAnswer,
    roundIndex: row.roundIndex,
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /api/rooms/:joinCode/messages?after=ISO時間戳 → 輪詢取得該時間點之後的新訊息
export async function GET(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const after = request.nextUrl.searchParams.get('after');
    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間' }, { status: 404 });
    }

    const rows = await prisma.roomMessage.findMany({
      where: { roomId: room.id, ...(after ? { createdAt: { gt: new Date(after) } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    return NextResponse.json({ messages: rows.map(toMessage) });
  } catch (err) {
    console.error(`[GET /api/rooms/${joinCode}/messages] 查詢失敗：`, err);
    return NextResponse.json({ error: '訊息查詢失敗' }, { status: 500 });
  }
}

// POST /api/rooms/:joinCode/messages → 傳送聊天訊息；若房間正在進行中且該題尚未公布答案，
// 會自動比對訊息內容是否等於正確歌名，答對者立刻得分，且伺服器當下就直接把房間推進到下一題
// 並排定好精確的開始時間（見 advanceRoundAfterReveal），不需要等額外的計時器或 API 呼叫。
export async function POST(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const body = await request.json();
    const { playerId, text } = body;
    if (!playerId || !text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間' }, { status: 404 });
    }
    const player = await prisma.roomPlayer.findUnique({ where: { id: playerId } });
    if (!player || player.roomId !== room.id) {
      return NextResponse.json({ error: '找不到這位玩家，可能已離開房間' }, { status: 404 });
    }

    let isCorrectAnswer = false;

    // 選擇題搶答模式（answerMode='choice'）下，聊天室純粹用來聊天，不用來搶答——
    // 答題只能透過選項按鈕（見 answer-choice route），避免打字打出正確歌名這條路
    // 繞過選擇題模式想要的「大家看同樣的選項、憑選項本身判斷」這個設計。
    if (room.status === 'playing' && room.answerMode === 'text' && !room.revealed && room.songQueue[room.currentRoundIndex]) {
      const songId = room.songQueue[room.currentRoundIndex];
      const song = await prisma.song.findUnique({ where: { id: songId } });
      if (song && isAnswerCorrect(text, song.title)) {
        // advanceRoundAfterReveal 用樂觀鎖保護：只有「這次呼叫讀到的還是當下真正那一輪」
        // 才會真的觸發轉換（回傳 true）。避免兩個人幾乎同時答對時，兩邊都以為自己是第一個、
        // 都加分、都各自把房間推進一次（等於直接跳過一整題）。
        const advanced = await advanceRoundAfterReveal(room.id, room.currentRoundIndex);
        if (advanced) {
          isCorrectAnswer = true;
          await prisma.roomPlayer.update({ where: { id: player.id }, data: { score: { increment: 1 } } });
        }
      }
    }

    const message = await prisma.roomMessage.create({
      data: {
        id: crypto.randomUUID(),
        roomId: room.id,
        playerId: player.id,
        displayName: player.displayName,
        text: text.trim(),
        isCorrectAnswer,
        roundIndex: room.status === 'playing' ? room.currentRoundIndex : null,
      },
    });

    return NextResponse.json({ message: toMessage(message) }, { status: 201 });
  } catch (err) {
    console.error(`[POST /api/rooms/${joinCode}/messages] 傳送訊息失敗：`, err);
    return NextResponse.json({ error: '傳送訊息失敗' }, { status: 500 });
  }
}
