import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { createStreakSession, type StreakPoolSong } from '../../../../lib/server/streakSession';
import { allowRequest, getClientIp } from '../../../../lib/server/rateLimit';

// POST /api/streak/start → 開始一場無限連勝。伺服器抽出第一首歌的隨機片段，
// 只回傳「這一段要播什麼」，不含歌名與答案。
export async function POST(request: NextRequest) {
  if (!allowRequest(`streak-start:${getClientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 });
  }
  try {
    const [songs, artists] = await Promise.all([prisma.song.findMany(), prisma.artist.findMany()]);
    const artistName = new Map(artists.map((a: { id: string; name: string }) => [a.id, a.name]));
    const pool: StreakPoolSong[] = songs.map((s) => ({
      id: s.id,
      title: s.title,
      artistName: artistName.get(s.artistId) ?? '',
      aliases: (s as { aliases?: string[] }).aliases ?? [],
      durationSec: s.durationSec,
      youtubeVideoId: s.youtubeVideoId,
      appleMusicPreviewUrl: s.appleMusicPreviewUrl,
      deezerPreviewUrl: s.deezerPreviewUrl,
      deezerTrackId: s.deezerTrackId,
    }));
    const created = createStreakSession(pool);
    if (!created) {
      return NextResponse.json({ error: '目前題庫沒有可播放的歌曲' }, { status: 400 });
    }
    return NextResponse.json(created);
  } catch (err) {
    console.error('[POST /api/streak/start] 開始挑戰失敗：', err);
    return NextResponse.json({ error: '開始挑戰失敗' }, { status: 500 });
  }
}
