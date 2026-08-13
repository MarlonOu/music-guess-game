import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';

// POST /api/rooms/:joinCode/leave → 玩家離開房間。
// 房主離開 = 整個房間直接刪除（連帶刪除底下所有玩家與聊天訊息，schema 已設 onDelete: Cascade）；
// 一般玩家離開 = 只移除自己這筆紀錄，房間繼續開著。
//
// 這支 API 刻意設計成「單一 POST、body 帶 playerId」而非 REST 風格的 DELETE，
// 是為了同時支援瀏覽器頁面關閉/切換時用 navigator.sendBeacon() 呼叫
// （sendBeacon 只能發 POST，無法自訂 method），確保「使用者直接關分頁」也有機會被偵測到。
export async function POST(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    // sendBeacon 送出的內容型別可能是 text/plain，仍需能解析出 JSON
    const raw = await request.text();
    const body = raw ? JSON.parse(raw) : {};
    const { playerId } = body;
    if (!playerId) {
      return NextResponse.json({ error: '缺少 playerId' }, { status: 400 });
    }

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!room) {
      // 房間可能已經被刪除，視為離開成功（冪等），避免前端還要特別處理「房間已不存在」的離開錯誤
      return NextResponse.json({ ok: true, roomDeleted: true });
    }

    if (room.hostPlayerId === playerId) {
      await prisma.room.delete({ where: { id: room.id } });
      return NextResponse.json({ ok: true, roomDeleted: true });
    }

    await prisma.roomPlayer.deleteMany({ where: { id: playerId, roomId: room.id } });
    return NextResponse.json({ ok: true, roomDeleted: false });
  } catch (err) {
    console.error(`[POST /api/rooms/${joinCode}/leave] 離開房間失敗：`, err);
    return NextResponse.json({ error: '離開房間失敗' }, { status: 500 });
  }
}
