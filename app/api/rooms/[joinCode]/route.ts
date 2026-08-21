import { NextRequest, NextResponse } from 'next/server';
import { loadRoomState } from '../../../../lib/server/roomState';

// GET /api/rooms/:joinCode → 輪詢房間目前狀態（含玩家清單、目前題目、比分）
// 回應裡的 serverTime 供客戶端校正自己裝置時鐘跟伺服器時鐘的偏移量（見 lib/client/serverClock.ts）——
// roundStartedAt／lastRevealedAt 這些時間戳都是伺服器時鐘產生的，如果裝置本身時鐘不準
// （沒開自動校時、時區跳動沒校正回來，手機上很常見），直接拿裝置的 Date.now() 去比較
// 會讓那台裝置的倒數/換題時機固定差一截，這是先前「某裝置似乎固定慢一秒」的成因。
export async function GET(_request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const state = await loadRoomState(joinCode.toUpperCase());
    if (!state) {
      return NextResponse.json({ error: '找不到這個房間，請確認房號是否正確' }, { status: 404 });
    }
    return NextResponse.json({ room: state, serverTime: new Date().toISOString() });
  } catch (err) {
    console.error(`[GET /api/rooms/${joinCode}] 查詢失敗：`, err);
    return NextResponse.json({ error: '房間狀態查詢失敗' }, { status: 500 });
  }
}
