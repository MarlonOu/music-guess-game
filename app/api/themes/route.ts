import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import type { Theme } from '../../../lib/types/theme';

// GET /api/themes → 全部主題清單，供主題篩選（男歌手、90年代金曲等）使用
export async function GET() {
  try {
    const rows = await prisma.theme.findMany({ orderBy: { name: 'asc' } });
    const themes: Theme[] = rows.map((r: { id: string; name: string; description: string }) => ({
      id: r.id,
      name: r.name,
      description: r.description,
    }));
    return NextResponse.json({ themes });
  } catch (err) {
    console.error('[GET /api/themes] 查詢失敗：', err);
    return NextResponse.json({ error: '主題清單查詢失敗' }, { status: 500 });
  }
}

// POST /api/themes → 新增主題
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description } = body;
    if (!name) {
      return NextResponse.json({ error: '缺少必要欄位（name）' }, { status: 400 });
    }
    const row = await prisma.theme.create({
      data: { id: crypto.randomUUID(), name, description: description ?? '' },
    });
    return NextResponse.json({ theme: { id: row.id, name: row.name, description: row.description } }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/themes] 新增失敗：', err);
    return NextResponse.json({ error: '新增主題失敗' }, { status: 500 });
  }
}
