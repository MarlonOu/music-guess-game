import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';
import { getRandomClipStart, DEFAULT_CLIP_DURATION_SEC } from '../../../../../lib/engine/modes/randomClipMode';
import { pickRandomLyricLine } from '../../../../../lib/engine/modes/lyricLineMode';

// 線上模式每場固定題數，與單機模式「玩完整個篩選題庫」的設計不同——
// 線上比賽要在合理時間內結束，避免有人中途離開晾著其他人。
export const ROOM_ROUND_COUNT = 10;

// POST /api/rooms/:joinCode/start → 房主開始遊戲，依篩選條件抽題並鎖定本輪隨機性
export async function POST(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const body = await request.json();
    const { playerId } = body;

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間' }, { status: 404 });
    }
    if (room.hostPlayerId !== playerId) {
      return NextResponse.json({ error: '只有房主可以開始遊戲' }, { status: 403 });
    }

    const songs = await prisma.song.findMany({
      where: {
        ...(room.artistFilterIds.length > 0 ? { artistId: { in: room.artistFilterIds } } : {}),
        ...(room.themeFilterIds.length > 0
          ? { themes: { some: { themeId: { in: room.themeFilterIds } } } }
          : {}),
      },
    });
    // 保險去重：`themes: { some: ... } }` 在 Prisma 底層是轉成 EXISTS 子查詢過濾，本來就不會
    // 讓同一首歌因為符合多個主題而重複出現在結果中；這裡仍明確用 Map 依 id 去重一次，
    // 把「複選主題時同一首歌只算一次」這個不變量直接寫進程式碼，不只是隱含依賴 ORM 的查詢實作細節。
    const uniqueSongs = Array.from(new Map(songs.map((s) => [s.id, s])).values());

    if (uniqueSongs.length === 0) {
      return NextResponse.json({ error: '目前篩選條件下沒有可用的歌曲，請重新調整設定' }, { status: 400 });
    }

    const shuffled = [...uniqueSongs]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(ROOM_ROUND_COUNT, uniqueSongs.length));

    const clipStartSecs: number[] = [];
    const lyricLineIndexes: number[] = [];
    for (const song of shuffled) {
      if (room.mode === 'RANDOM_CLIP') {
        const effectiveDuration = song.durationSec > 0 ? song.durationSec : DEFAULT_CLIP_DURATION_SEC;
        clipStartSecs.push(getRandomClipStart(effectiveDuration, Math.min(DEFAULT_CLIP_DURATION_SEC, effectiveDuration)));
      } else {
        clipStartSecs.push(0);
      }
      if (room.mode === 'LYRIC_LINE') {
        lyricLineIndexes.push(pickRandomLyricLine(song.lyrics).index);
      } else {
        lyricLineIndexes.push(0);
      }
    }

    await prisma.room.update({
      where: { id: room.id },
      data: {
        status: 'playing',
        songQueue: shuffled.map((s) => s.id),
        clipStartSecs,
        lyricLineIndexes,
        currentRoundIndex: 0,
        revealed: false,
        roundStartedAt: new Date(),
      },
    });
    // 每輪重新開始比分歸零，讓「返回房間再玩一輪」有乾淨的起點
    await prisma.roomPlayer.updateMany({ where: { roomId: room.id }, data: { score: 0 } });

    const state = await loadRoomState(room.joinCode);
    return NextResponse.json({ room: state });
  } catch (err) {
    console.error(`[POST /api/rooms/${joinCode}/start] 開始遊戲失敗：`, err);
    return NextResponse.json({ error: '開始遊戲失敗' }, { status: 500 });
  }
}
