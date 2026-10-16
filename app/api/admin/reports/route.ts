import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

const STATUSES = ['open', 'resolved', 'ignored'];

function toSummary(r: {
  id: string; category: string; message: string; nickname: string; contact: string; route: string;
  userAgent: string; env: unknown; logCount: number; errorCount: number; status: string;
  adminNote: string; createdAt: Date; resolvedAt: Date | null;
}) {
  return {
    id: r.id, category: r.category, message: r.message, nickname: r.nickname, contact: r.contact,
    route: r.route, userAgent: r.userAgent, env: r.env, logCount: r.logCount, errorCount: r.errorCount,
    status: r.status, adminNote: r.adminNote,
    createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  };
}

// GET /api/admin/reports?status=open  （列表不含 logs，避免回傳過大）
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status') ?? 'open';
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: '狀態不正確' }, { status: 400 });
  }
  const [rows, grouped] = await Promise.all([
    prisma.errorReport.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, category: true, message: true, nickname: true, contact: true, route: true,
        userAgent: true, env: true, logCount: true, errorCount: true, status: true,
        adminNote: true, createdAt: true, resolvedAt: true,
      },
    }),
    prisma.errorReport.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const counts: Record<string, number> = { open: 0, resolved: 0, ignored: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;
  return NextResponse.json({ reports: rows.map(toSummary), counts });
}

// DELETE /api/admin/reports?status=resolved|ignored  批次清除已結案的回報
export async function DELETE(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status');
  if (status !== 'resolved' && status !== 'ignored') {
    return NextResponse.json({ error: '只能批次刪除已處理或已忽略的回報' }, { status: 400 });
  }
  const result = await prisma.errorReport.deleteMany({ where: { status } });
  return NextResponse.json({ deleted: result.count });
}
