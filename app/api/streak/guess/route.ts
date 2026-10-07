import { NextRequest, NextResponse } from 'next/server';
import { guessStreak } from '../../../../lib/server/streakSession';

// POST /api/streak/guess → 提交一次猜測（songId 為自動完成選到的歌，或自由輸入的 text）。
// 對錯、段落推進、連勝與分數全部由伺服器判定。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, songId, text } = body;
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }
    const result = guessStreak(token, {
      songId: typeof songId === 'string' ? songId : undefined,
      text: typeof text === 'string' ? text : undefined,
    });
    if (!result) {
      return NextResponse.json({ error: '挑戰已結束或不存在，請重新開始' }, { status: 404 });
    }
    if (result.result === 'tooFast') {
      return NextResponse.json({ error: '請先聽完這一段再作答', retryAfterMs: result.retryAfterMs }, { status: 429 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/streak/guess] 判定失敗：', err);
    return NextResponse.json({ error: '判定失敗' }, { status: 500 });
  }
}
