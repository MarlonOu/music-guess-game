import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import type { Artist } from '../../../lib/types/theme';

// GET /api/artists → 全部歌手清單，供 ArtistFilter（Phase 3）使用
export async function GET() {
  try {
    const rows = await prisma.artist.findMany({ orderBy: { name: 'asc' } });
    const artists: Artist[] = rows.map(
      (r: { id: string; name: string; gender: string }): Artist => ({
        id: r.id,
        name: r.name,
        gender: r.gender as Artist['gender'],
      })
    );
    return NextResponse.json({ artists });
  } catch (err) {
    console.error('[GET /api/artists] 查詢失敗：', err);
    return NextResponse.json({ error: '歌手清單查詢失敗' }, { status: 500 });
  }
}

// POST /api/artists → 新增一位歌手，供 /admin 資料庫管理頁面使用
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, gender } = body;

    if (!name) {
      return NextResponse.json({ error: '缺少必要欄位（name）' }, { status: 400 });
    }

    const row = await prisma.artist.create({
      data: { id: crypto.randomUUID(), name, gender: gender ?? 'UNKNOWN' },
    });

    return NextResponse.json(
      { artist: { id: row.id, name: row.name, gender: row.gender } },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/artists] 新增失敗：', err);
    return NextResponse.json({ error: '新增歌手失敗' }, { status: 500 });
  }
}
