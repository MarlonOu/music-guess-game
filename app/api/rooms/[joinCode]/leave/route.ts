import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';

// POST /api/rooms/:joinCode/leave → 玩家離開房間。
// 一般玩家離開 = 只移除自己這筆紀錄，房間繼續開著。
// 房主離開：房間裡還有其他人的話，隨機指派剩下玩家裡的一位當新房主，房間繼續開著、不刪除
// （這是為了因應 pagehide 事件在「重新整理頁面」時也會誤觸發離開通知的情況——房主單純重新
// 整理一下頁面，不該害全部人的房間直接消失，見 online room 頁面 pagehide 那段說明）；
// 只有房間裡完全沒有其他人了，才真的刪除整個房間（連帶刪除底下所有玩家與聊天訊息，
// schema 已設 onDelete: Cascade）。
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
      const remainingPlayers = await prisma.roomPlayer.findMany({
        where: { roomId: room.id, id: { not: playerId } },
      });

      if (remainingPlayers.length === 0) {
        // 沒有其他人可以接手房主，房間留著也沒有意義，直接刪除
        await prisma.room.delete({ where: { id: room.id } });
        return NextResponse.json({ ok: true, roomDeleted: true });
      }

      const newHost = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];
      await prisma.$transaction([
        prisma.room.update({ where: { id: room.id }, data: { hostPlayerId: newHost.id } }),
        prisma.roomPlayer.deleteMany({ where: { id: playerId, roomId: room.id } }),
      ]);
      return NextResponse.json({ ok: true, roomDeleted: false, newHostPlayerId: newHost.id });
    }

    await prisma.roomPlayer.deleteMany({ where: { id: playerId, roomId: room.id } });
    return NextResponse.json({ ok: true, roomDeleted: false });
  } catch (err) {
    console.error(`[POST /api/rooms/${joinCode}/leave] 離開房間失敗：`, err);
    return NextResponse.json({ error: '離開房間失敗' }, { status: 500 });
  }
}
