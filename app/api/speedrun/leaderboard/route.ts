import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

const LEADERBOARD_SIZE = 100;

// GET /api/speedrun/leaderboard → 單純查詢目前的排行榜，不需要玩過一場才看得到
// （例如挑戰開始前想先看看目前門檻大概多快）。
export async function GET() {
  try {
    const leaderboard = await prisma.speedrunScore.findMany({
      orderBy: { totalTimeMs: 'asc' },
      take: LEADERBOARD_SIZE,
      select: { id: true, displayName: true, totalTimeMs: true },
    });
    return NextResponse.json({ leaderboard });
  } catch (err) {
    console.error('[GET /api/speedrun/leaderboard] 查詢排行榜失敗：', err);
    return NextResponse.json({ error: '查詢排行榜失敗' }, { status: 500 });
  }
}
