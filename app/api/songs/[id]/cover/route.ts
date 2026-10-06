import { NextRequest, NextResponse } from 'next/server';
import { resolveSongCoverUrl } from '../../../../../lib/server/songCover';

// GET /api/songs/:id/cover → { coverUrl: string | null }，單機模式公布答案時用
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const coverUrl = await resolveSongCoverUrl(id);
    return NextResponse.json({ coverUrl });
  } catch (err) {
    console.error(`[GET /api/songs/${id}/cover] 查詢封面失敗：`, err);
    return NextResponse.json({ coverUrl: null });
  }
}
