import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';
import { getRandomClipStart, DEFAULT_CLIP_DURATION_SEC } from '../../../../../lib/engine/modes/randomClipMode';
import { pickRandomLyricLine } from '../../../../../lib/engine/modes/lyricLineMode';
import { buildChoiceSongIds } from '../../../../../lib/server/choiceMode';

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
      // 選擇題搶答模式挑干擾選項需要知道每首歌的主題（見 lib/server/choiceMode.ts），
      // 一併帶出來，answerMode='text' 時這個 include 也不影響原本的流程，成本很低。
      include: { themes: { select: { themeId: true } } },
    });
    // 保險去重：`themes: { some: ... } }` 在 Prisma 底層是轉成 EXISTS 子查詢過濾，本來就不會
    // 讓同一首歌因為符合多個主題而重複出現在結果中；這裡仍明確用 Map 依 id 去重一次，
    // 把「複選主題時同一首歌只算一次」這個不變量直接寫進程式碼，不只是隱含依賴 ORM 的查詢實作細節。
    const uniqueSongs = Array.from(new Map(songs.map((s) => [s.id, s])).values()).map((s) => ({
      ...s,
      themeIds: s.themes.map((t: { themeId: string }) => t.themeId),
    }));

    if (uniqueSongs.length === 0) {
      return NextResponse.json({ error: '目前篩選條件下沒有可用的歌曲，請重新調整設定' }, { status: 400 });
    }

    const shuffled = [...uniqueSongs]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(ROOM_ROUND_COUNT, uniqueSongs.length));

    // 選擇題搶答模式：從整個候選池（uniqueSongs，不只是抽到的這幾首）挑干擾選項，
    // 讓「同主題/同歌手優先」這個機制有足夠素材可以發揮（見 lib/server/choiceMode.ts 的說明）。
    // 攤平存成一維陣列，跟 clipStartSecs／lyricLineIndexes 同樣的設計理由：所有玩家看到的
    // 選項與順序要一致，只能在開始遊戲這一刻算好、存起來，不能讓每個玩家的裝置各自重算。
    const choiceSongIds = room.answerMode === 'choice' ? buildChoiceSongIds(shuffled, uniqueSongs) : [];

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
        choiceSongIds,
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
