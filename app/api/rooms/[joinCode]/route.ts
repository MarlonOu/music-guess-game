import { NextRequest, NextResponse } from 'next/server';
import { loadRoomState } from '../../../../lib/server/roomState';

// GET /api/rooms/:joinCode → 輪詢房間目前狀態（含玩家清單、目前題目、比分）
export async function GET(_request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const state = await loadRoomState(joinCode.toUpperCase());
    if (!state) {
      return NextResponse.json({ error: '找不到這個房間，請確認房號是否正確' }, { status: 404 });
    }
    return NextResponse.json({ room: state });
  } catch (err) {
    console.error(`[GET /api/rooms/${joinCode}] 查詢失敗：`, err);
    return NextResponse.json({ error: '房間狀態查詢失敗' }, { status: 500 });
  }
}
