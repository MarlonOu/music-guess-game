import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import type { Song } from '../../../lib/types/song';

function toSong(row: {
  id: string;
  title: string;
  artistId: string;
  audioUrl: string | null;
  youtubeVideoId: string | null;
  appleMusicTrackId: string | null;
  appleMusicPreviewUrl: string | null;
  deezerTrackId: string | null;
  deezerPreviewUrl: string | null;
  appleMusicSkip: boolean;
  deezerSkip: boolean;
  durationSec: number;
  lyrics: string;
  createdAt: Date;
  themes?: { themeId: string }[];
}): Song {
  return {
    id: row.id,
    title: row.title,
    artistId: row.artistId,
    audioUrl: row.audioUrl ?? undefined,
    youtubeVideoId: row.youtubeVideoId ?? undefined,
    appleMusicTrackId: row.appleMusicTrackId ?? undefined,
    appleMusicPreviewUrl: row.appleMusicPreviewUrl ?? undefined,
    deezerTrackId: row.deezerTrackId ?? undefined,
    deezerPreviewUrl: row.deezerPreviewUrl ?? undefined,
    appleMusicSkip: row.appleMusicSkip,
    deezerSkip: row.deezerSkip,
    durationSec: row.durationSec,
    lyrics: row.lyrics,
    createdAt: row.createdAt.toISOString(),
    themeIds: (row.themes ?? []).map((t) => t.themeId),
  };
}

// GET /api/songs                              → 全部歌曲
// GET /api/songs?artistIds=a1,a2               → 依歌手篩選
// GET /api/songs?themeIds=t1,t2                → 依主題篩選
// GET /api/songs?artistIds=a1&themeIds=t1       → 歌手與主題篩選以交集方式套用
export async function GET(request: NextRequest) {
  try {
    const artistIdsParam = request.nextUrl.searchParams.get('artistIds');
    const artistIds = artistIdsParam ? artistIdsParam.split(',').filter(Boolean) : [];
    const themeIdsParam = request.nextUrl.searchParams.get('themeIds');
    const themeIds = themeIdsParam ? themeIdsParam.split(',').filter(Boolean) : [];

    const rows = await prisma.song.findMany({
      where: {
        ...(artistIds.length > 0 ? { artistId: { in: artistIds } } : {}),
        ...(themeIds.length > 0 ? { themes: { some: { themeId: { in: themeIds } } } } : {}),
      },
      include: { themes: { select: { themeId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    // 保險去重：理由同 rooms/start——複選多個主題時，同一首歌只應該出現一次，
    // 不應該因為它同時符合好幾個被選中的主題而被算進題庫兩次以上。
    const uniqueRows = Array.from(new Map(rows.map((r) => [r.id, r])).values());

    return NextResponse.json({ songs: uniqueRows.map(toSong) });
  } catch (err) {
    console.error('[GET /api/songs] 查詢失敗：', err);
    return NextResponse.json({ error: '題庫查詢失敗' }, { status: 500 });
  }
}

// POST /api/songs → 新增一首歌曲，供 /admin 資料庫管理頁面使用；themeIds 為選填的主題指派清單
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      artistId,
      youtubeVideoId,
      appleMusicTrackId,
      appleMusicPreviewUrl,
      deezerTrackId,
      deezerPreviewUrl,
      appleMusicSkip,
      deezerSkip,
      durationSec,
      lyrics,
      themeIds,
    } = body;

    // 至少要有一種可播放來源（YouTube／Apple Music／Deezer 三選一以上），不可全無，
    // 否則這首歌進了題庫也沒辦法播放。優先建議填 Apple Music 或 Deezer（見
    // resolvePlaybackTarget.ts 說明的控制中心洩漏問題），但沒有強制要求一定要有，維持彈性。
    if (!title || !artistId || (!youtubeVideoId && !appleMusicPreviewUrl && !deezerPreviewUrl)) {
      return NextResponse.json(
        {
          error:
            '缺少必要欄位（title、artistId，並且 youtubeVideoId／appleMusicPreviewUrl／deezerPreviewUrl 至少要有一個）',
        },
        { status: 400 }
      );
    }

    const row = await prisma.song.create({
      data: {
        id: crypto.randomUUID(),
        title,
        artistId,
        youtubeVideoId: youtubeVideoId || null,
        appleMusicTrackId: appleMusicTrackId || null,
        appleMusicPreviewUrl: appleMusicPreviewUrl || null,
        deezerTrackId: deezerTrackId || null,
        deezerPreviewUrl: deezerPreviewUrl || null,
        appleMusicSkip: Boolean(appleMusicSkip),
        deezerSkip: Boolean(deezerSkip),
        durationSec: Number(durationSec) || 0,
        lyrics: lyrics ?? '',
        themes: Array.isArray(themeIds) && themeIds.length > 0
          ? { create: themeIds.map((themeId: string) => ({ themeId })) }
          : undefined,
      },
      include: { themes: { select: { themeId: true } } },
    });

    return NextResponse.json({ song: toSong(row) }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/songs] 新增失敗：', err);
    return NextResponse.json({ error: '新增歌曲失敗，請確認歌手 id 是否存在' }, { status: 500 });
  }
}
