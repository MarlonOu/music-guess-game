import { NextRequest, NextResponse } from 'next/server';
import { endStreak } from '../../../../lib/server/streakSession';

// POST /api/streak/end → 答對後選擇結束挑戰，結算目前連勝
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }
    const result = endStreak(token);
    if (!result) {
      return NextResponse.json({ error: '挑戰已結束或不存在，請重新開始' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/streak/end] 失敗：', err);
    return NextResponse.json({ error: '操作失敗' }, { status: 500 });
  }
}
