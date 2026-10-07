import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// GET /api/songs/index → 輸入搜尋（自動完成）用的精簡索引：只有歌名與歌手名。
// 刻意不含別名、播放來源、歌曲長度等欄位，遊戲中的搜尋輸入框不需要、也不該拿到這些資料。
export async function GET() {
  try {
    const [songs, artists] = await Promise.all([
      prisma.song.findMany({ select: { id: true, title: true, artistId: true } }),
      prisma.artist.findMany({ select: { id: true, name: true } }),
    ]);
    const artistName = new Map(artists.map((a: { id: string; name: string }) => [a.id, a.name]));
    const index = songs.map((s: { id: string; title: string; artistId: string }) => ({
      id: s.id,
      title: s.title,
      artist: artistName.get(s.artistId) ?? '',
    }));
    return NextResponse.json({ songs: index }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    console.error('[GET /api/songs/index] 查詢失敗：', err);
    return NextResponse.json({ error: '歌曲索引查詢失敗' }, { status: 500 });
  }
}
