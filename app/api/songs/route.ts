import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import type { Song } from '../../../lib/types/song';

function toSong(row: {
  id: string;
  title: string;
  artistId: string;
  audioUrl: string | null;
  youtubeVideoId: string;
  durationSec: number;
  lyrics: string;
  createdAt: Date;
}): Song {
  return {
    id: row.id,
    title: row.title,
    artistId: row.artistId,
    audioUrl: row.audioUrl ?? undefined,
    youtubeVideoId: row.youtubeVideoId,
    durationSec: row.durationSec,
    lyrics: row.lyrics,
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /api/songs            → 全部歌曲
// GET /api/songs?artistIds=a1,a2 → 依歌手篩選（對應 SongRepository.getByArtistIds）
export async function GET(request: NextRequest) {
  try {
    const artistIdsParam = request.nextUrl.searchParams.get('artistIds');
    const artistIds = artistIdsParam ? artistIdsParam.split(',').filter(Boolean) : [];

    const rows = await prisma.song.findMany({
      where: artistIds.length > 0 ? { artistId: { in: artistIds } } : undefined,
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ songs: rows.map(toSong) });
  } catch (err) {
    console.error('[GET /api/songs] 查詢失敗：', err);
    return NextResponse.json({ error: '題庫查詢失敗' }, { status: 500 });
  }
}

// POST /api/songs → 新增一首歌曲，供 /admin 資料庫管理頁面使用
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, artistId, youtubeVideoId, durationSec, lyrics } = body;

    if (!title || !artistId || !youtubeVideoId) {
      return NextResponse.json({ error: '缺少必要欄位（title、artistId、youtubeVideoId）' }, { status: 400 });
    }

    const row = await prisma.song.create({
      data: {
        id: crypto.randomUUID(),
        title,
        artistId,
        youtubeVideoId,
        durationSec: Number(durationSec) || 0,
        lyrics: lyrics ?? '',
      },
    });

    return NextResponse.json({ song: toSong(row) }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/songs] 新增失敗：', err);
    return NextResponse.json({ error: '新增歌曲失敗，請確認歌手 id 是否存在' }, { status: 500 });
  }
}
