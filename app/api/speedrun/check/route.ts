import { NextRequest, NextResponse } from 'next/server';
import { checkSpeedrunAnswer } from '../../../../lib/server/speedrunSession';

// POST /api/speedrun/check → 提交第 questionIndex 題選的 songId，判定對不對。
// 真相（哪首歌才是正確答案）只存在伺服器記憶體裡，/start 的回應不會把答案洩漏給客戶端；
// 這裡才是唯一判定對錯的地方，不是客戶端自己比對。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, questionIndex, songId } = body;
    if (!token || typeof questionIndex !== 'number' || !songId) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const result = checkSpeedrunAnswer(token, questionIndex, songId);
    if (!result) {
      return NextResponse.json({ error: '挑戰已逾時或不存在，請重新開始' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/speedrun/check] 判定失敗：', err);
    return NextResponse.json({ error: '判定失敗' }, { status: 500 });
  }
}
