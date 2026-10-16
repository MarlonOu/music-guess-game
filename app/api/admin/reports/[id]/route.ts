import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { cleanText } from '../../../../../lib/server/reportSanitize';

const STATUSES = ['open', 'resolved', 'ignored'];

// GET /api/admin/reports/:id  取得單筆（含完整操作紀錄）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await prisma.errorReport.findUnique({ where: { id }, select: { logs: true, env: true } });
  if (!r) return NextResponse.json({ error: '找不到這筆回報' }, { status: 404 });
  return NextResponse.json({ logs: r.logs, env: r.env });
}

// PATCH /api/admin/reports/:id  { status?, adminNote? }
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const data: { status?: string; adminNote?: string; resolvedAt?: Date | null } = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: '狀態不正確' }, { status: 400 });
    }
    data.status = body.status;
    data.resolvedAt = body.status === 'open' ? null : new Date();
  }
  if (body.adminNote !== undefined) data.adminNote = cleanText(body.adminNote, 500, true);
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '沒有要更新的欄位' }, { status: 400 });
  }
  try {
    await prisma.errorReport.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: '找不到這筆回報' }, { status: 404 });
  }
}

// DELETE /api/admin/reports/:id
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.errorReport.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: '找不到這筆回報' }, { status: 404 });
  }
}
