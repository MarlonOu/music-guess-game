import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { prisma } from '../../../../lib/db';
import { SONG_CSV_COLUMNS, THEME_LIST_SEPARATOR, type SongCsvRow } from '../../../../lib/csv/songCsv';

// GET /api/songs/export → 匯出全部歌曲為 CSV（格式定義見 lib/csv/songCsv.ts）
// 屬於讀取操作，跟 GET /api/songs 一樣不需要管理者密碼（見 proxy.ts 只保護非 GET 的異動請求）。
export async function GET() {
  try {
    const songs = await prisma.song.findMany({
      include: {
        artist: { select: { name: true } },
        themes: { include: { theme: { select: { name: true } } } },
      },
      orderBy: [{ artist: { name: 'asc' } }, { title: 'asc' }],
    });

    const rows: SongCsvRow[] = songs.map((s: {
      title: string;
      artist: { name: string };
      youtubeVideoId: string | null;
      appleMusicTrackId: string | null;
      appleMusicPreviewUrl: string | null;
      appleMusicSkip: boolean;
      deezerTrackId: string | null;
      deezerPreviewUrl: string | null;
      deezerSkip: boolean;
      durationSec: number;
      themes: { theme: { name: string } }[];
      lyrics: string;
    }) => ({
      title: s.title,
      artist: s.artist.name,
      youtubeVideoId: s.youtubeVideoId ?? '',
      appleMusicTrackId: s.appleMusicTrackId ?? '',
      appleMusicPreviewUrl: s.appleMusicPreviewUrl ?? '',
      appleMusicSkip: s.appleMusicSkip ? 'true' : '',
      deezerTrackId: s.deezerTrackId ?? '',
      deezerPreviewUrl: s.deezerPreviewUrl ?? '',
      deezerSkip: s.deezerSkip ? 'true' : '',
      durationSec: String(s.durationSec),
      themes: s.themes.map((t) => t.theme.name).join(THEME_LIST_SEPARATOR),
      lyrics: s.lyrics,
    }));

    const csv = Papa.unparse({ fields: [...SONG_CSV_COLUMNS], data: rows });
    // 加上 UTF-8 BOM，避免 Excel 開啟中文 CSV 時亂碼（Excel 不看 Content-Type 的 charset，只認 BOM）
    const csvWithBom = '\uFEFF' + csv;

    return new NextResponse(csvWithBom, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="songs-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error('[GET /api/songs/export] 匯出失敗：', err);
    return NextResponse.json({ error: '匯出失敗' }, { status: 500 });
  }
}
