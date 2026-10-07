import { NextRequest, NextResponse } from 'next/server';
import { skipStreakStage } from '../../../../lib/server/streakSession';

// POST /api/streak/stage → 多聽：解鎖下一段（不猜）
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }
    const result = skipStreakStage(token);
    if (!result) {
      return NextResponse.json({ error: '挑戰已結束或不存在，請重新開始' }, { status: 404 });
    }
    return NextResponse.json({ question: result });
  } catch (err) {
    console.error('[POST /api/streak/stage] 失敗：', err);
    return NextResponse.json({ error: '操作失敗' }, { status: 500 });
  }
}
