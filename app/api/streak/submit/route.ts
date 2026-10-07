import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { finalizeStreakSession } from '../../../../lib/server/streakSession';
import { allowRequest, getClientIp } from '../../../../lib/server/rateLimit';
import { sanitizeDisplayName } from '../../../../lib/server/sanitizeName';

const LEADERBOARD_SIZE = 100;

// POST /api/streak/submit → 挑戰結束後交出成績寫入排行榜。連勝與分數完全由伺服器 session
// 累計得出，客戶端不能指定數字；session 一次性使用，同一場挑戰無法重複送出。
// 沒有答對任何一首（連勝 0）不上榜。
export async function POST(request: NextRequest) {
  try {
    if (!allowRequest(`streak-submit:${getClientIp(request)}`, 10, 60_000)) {
      return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 });
    }
    const body = await request.json();
    const { token } = body;
    const displayName = sanitizeDisplayName(body.displayName);
    if (!token || typeof token !== 'string' || !displayName) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const finalized = finalizeStreakSession(token);
    if (!finalized) {
      return NextResponse.json({ error: '這場挑戰還沒結束，或已經逾時失效，請重新開始' }, { status: 409 });
    }
    if (finalized.streak <= 0) {
      return NextResponse.json({ error: '至少要答對一首才能上榜' }, { status: 422 });
    }

    const entry = await prisma.streakScore.create({
      data: { id: crypto.randomUUID(), displayName, streak: finalized.streak, score: finalized.score },
    });

    const [betterCount, totalRuns, leaderboard] = await Promise.all([
      prisma.streakScore.count({
        where: {
          OR: [
            { streak: { gt: finalized.streak } },
            { streak: finalized.streak, score: { gt: finalized.score } },
          ],
        },
      }),
      prisma.streakScore.count(),
      prisma.streakScore.findMany({
        orderBy: [{ streak: 'desc' }, { score: 'desc' }, { createdAt: 'asc' }],
        take: LEADERBOARD_SIZE,
        select: { id: true, displayName: true, streak: true, score: true },
      }),
    ]);

    return NextResponse.json({
      streak: finalized.streak,
      score: finalized.score,
      rank: betterCount + 1,
      totalRuns,
      scoreId: entry.id,
      leaderboard,
    });
  } catch (err) {
    console.error('[POST /api/streak/submit] 送出成績失敗：', err);
    return NextResponse.json({ error: '送出成績失敗' }, { status: 500 });
  }
}
