import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { finalizeSpeedrunSession } from '../../../../lib/server/speedrunSession';

const LEADERBOARD_SIZE = 100;
const DISPLAY_NAME_MAX_LENGTH = 20;

// POST /api/speedrun/submit → 挑戰完成後交出成績，寫入排行榜，回傳這次的名次與前 100 名榜單。
// 成績（totalTimeMs）完全由伺服器依 session 記錄的開始/完成時間戳算出（見
// lib/server/speedrunSession.ts），不採信客戶端自己回報的數字，避免竄改成績上榜。
// finalizeSpeedrunSession 是一次性的（成功後就把 session 從記憶體移除），
// 同一場挑戰沒辦法重複送出成績。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, displayName } = body;
    if (!token || !displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const finalized = finalizeSpeedrunSession(token);
    if (!finalized) {
      return NextResponse.json({ error: '這場挑戰還沒完成，或已經逾時失效，請重新開始' }, { status: 409 });
    }

    const score = await prisma.speedrunScore.create({
      data: {
        id: crypto.randomUUID(),
        displayName: displayName.trim().slice(0, DISPLAY_NAME_MAX_LENGTH),
        totalTimeMs: finalized.totalTimeMs,
      },
    });

    const [fasterCount, totalRuns, leaderboard] = await Promise.all([
      prisma.speedrunScore.count({ where: { totalTimeMs: { lt: finalized.totalTimeMs } } }),
      prisma.speedrunScore.count(),
      prisma.speedrunScore.findMany({
        orderBy: { totalTimeMs: 'asc' },
        take: LEADERBOARD_SIZE,
        select: { id: true, displayName: true, totalTimeMs: true },
      }),
    ]);

    return NextResponse.json({
      totalTimeMs: finalized.totalTimeMs,
      rank: fasterCount + 1,
      totalRuns,
      scoreId: score.id,
      leaderboard,
    });
  } catch (err) {
    console.error('[POST /api/speedrun/submit] 送出成績失敗：', err);
    return NextResponse.json({ error: '送出成績失敗' }, { status: 500 });
  }
}
