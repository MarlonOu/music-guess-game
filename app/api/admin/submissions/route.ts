import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { loadDuplicateContext, runDuplicateCheck, toSubmissionView } from '../../../../lib/server/submissionStore';

// GET /api/admin/submissions?status=pending|approved|rejected → 投稿清單（受 proxy.ts 保護）
// 待審核項目附上以「目前題庫」即時重算的重複性檢查：投稿之後題庫可能又新增了同一首歌。
export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status') ?? 'pending';
    const valid = ['pending', 'approved', 'rejected'];
    const where = valid.includes(status) ? { status } : {};
    const [rows, grouped] = await Promise.all([
      prisma.songSubmission.findMany({
        where,
        orderBy: status === 'pending' ? { createdAt: 'asc' } : { reviewedAt: 'desc' },
        take: 300,
      }),
      prisma.songSubmission.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const g of grouped) {
      if (g.status in counts) counts[g.status as keyof typeof counts] = g._count._all;
    }

    const ctx = status === 'pending' ? await loadDuplicateContext() : null;
    const submissions = rows.map((r: (typeof rows)[number]) =>
      toSubmissionView(
        r,
        ctx
          ? runDuplicateCheck(
              ctx,
              {
                videoId: r.youtubeVideoId,
                rawTitle: r.videoTitle,
                channelTitle: r.channelTitle,
                title: r.title,
                artistName: r.artistName,
              },
              undefined,
              r.id
            )
          : undefined
      )
    );
    return NextResponse.json({ submissions, counts });
  } catch (err) {
    console.error('[GET /api/admin/submissions] 失敗：', err);
    return NextResponse.json({ error: '讀取投稿失敗' }, { status: 500 });
  }
}
