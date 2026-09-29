import { NextRequest, NextResponse } from 'next/server';
import { reportAudioWait } from '../../../../lib/server/speedrunSession';

// POST /api/speedrun/audio-started → 客戶端偵測到目前這一題的音樂真的開始播放（或明確判定
//放不出來）時呼叫，帶著自己量測到的等待毫秒數，用來扣除裝置網路不好、音訊緩衝拖延到的
// 等待時間（見 lib/server/speedrunSession.ts reportAudioWait 的完整說明，包含為什麼改成
// 客戶端回報量測值、以及防濫用的上限機制）。
// 這支路由本身沒有「失敗」的概念需要回報給前端——不管 token／questionIndex 合不合理
// （挑戰已經結束、題號對不上等），reportAudioWait 內部都會直接忽略，前端不需要
// 特別處理這支請求失敗的情況，純粹是「盡量回報，回報不了就算了」，不影響主要的答題流程。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, questionIndex, waitMs } = body;
    if (!token || typeof questionIndex !== 'number' || typeof waitMs !== 'number') {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }
    reportAudioWait(token, questionIndex, waitMs);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/speedrun/audio-started] 回報失敗：', err);
    return NextResponse.json({ error: '回報失敗' }, { status: 500 });
  }
}
