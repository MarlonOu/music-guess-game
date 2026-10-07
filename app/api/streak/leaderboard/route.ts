import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

const LEADERBOARD_SIZE = 100;

// GET /api/streak/leaderboard → 目前的無限連勝排行榜（連勝首數、總分由高到低）
export async function GET() {
  try {
    const leaderboard = await prisma.streakScore.findMany({
      orderBy: [{ streak: 'desc' }, { score: 'desc' }, { createdAt: 'asc' }],
      take: LEADERBOARD_SIZE,
      select: { id: true, displayName: true, streak: true, score: true },
    });
    return NextResponse.json({ leaderboard });
  } catch (err) {
    console.error('[GET /api/streak/leaderboard] 查詢排行榜失敗：', err);
    return NextResponse.json({ error: '查詢排行榜失敗' }, { status: 500 });
  }
}
