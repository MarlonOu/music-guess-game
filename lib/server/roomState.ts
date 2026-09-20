import { prisma } from '../db';
import type { RoomState } from '../types/room';
import type { QuestionPayload } from '../types/question';
import type { GameMode } from '../types/match';
import { FIXED_INTRO_DURATION_SEC } from '../engine/modes/introMode';
import { DEFAULT_CLIP_DURATION_SEC } from '../engine/modes/randomClipMode';
import { resolvePlaybackTarget } from '../audio/resolvePlaybackTarget';
import { CHOICES_PER_ROUND } from './choiceMode';

/**
 * 依房間存好的 songQueue / clipStartSecs / lyricLineIndexes 重建當前題目，
 * 刻意不呼叫 GameModeStrategy.prepareQuestion()（那會重新呼叫 Math.random() 重算隨機片段/歌詞行，
 * 導致每次輪詢拿到不同結果）——RANDOM_CLIP、LYRIC_LINE 的隨機性只在房主開始遊戲那一刻決定一次。
 */
function buildQuestionFromRoom(
  mode: GameMode,
  song: { id: string; title: string; lyrics: string },
  clipStartSec: number,
  lyricLineIndex: number
): QuestionPayload {
  switch (mode) {
    case 'INTRO':
      return {
        songId: song.id,
        renderType: 'audio-intro',
        introEndSec: FIXED_INTRO_DURATION_SEC,
        correctTitle: song.title,
      };
    case 'RANDOM_CLIP':
      return {
        songId: song.id,
        renderType: 'audio-clip',
        clipStartSec,
        clipDurationSec: DEFAULT_CLIP_DURATION_SEC,
        correctTitle: song.title,
      };
    case 'LYRIC_LINE': {
      const lines = song.lyrics
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const line = lines[lyricLineIndex] ?? '';
      return {
        songId: song.id,
        renderType: 'text-lyric',
        lyricLineText: line,
        lyricLineIndex,
        correctTitle: song.title,
      };
    }
  }
}

/**
 * 讀取房間目前狀態，組成可以直接回傳給前端輪詢的公開格式。
 * 關鍵：revealed 為 false 時，把 correctTitle 抹成空字串，
 * 避免玩家對著 API 回應（DevTools Network 分頁）就能直接偷看答案。
 */
export async function loadRoomState(joinCode: string): Promise<RoomState | null> {
  const room = await prisma.room.findUnique({
    where: { joinCode },
    include: { players: { orderBy: { joinedAt: 'asc' } } },
  });
  if (!room) return null;

  let currentQuestion: QuestionPayload | null = null;
  let currentSongSource: 'youtube' | 'apple' | 'deezer' | null = null;
  let currentSongPlaybackId: string | null = null;
  let currentSongArtist: string | null = null;
  let currentSongThemeLabels: string[] = [];
  let currentChoices: RoomState['currentChoices'] = [];

  if (room.status === 'playing' && room.songQueue[room.currentRoundIndex]) {
    const songId = room.songQueue[room.currentRoundIndex];
    const song = await prisma.song.findUnique({
      where: { id: songId },
      include: { artist: true, themes: { include: { theme: true } } },
    });
    if (song) {
      const clipStartSec = room.clipStartSecs[room.currentRoundIndex] ?? 0;
      const lyricLineIndex = room.lyricLineIndexes[room.currentRoundIndex] ?? 0;
      const question = buildQuestionFromRoom(room.mode as GameMode, song, clipStartSec, lyricLineIndex);
      currentQuestion = room.revealed ? question : { ...question, correctTitle: '' };
      // 播放來源／識別碼不受 revealed 影響，跟先前 currentSongVideoId 的行為一致——
      // 知道「要播哪個音源」不等於知道歌名，本來就一直是這樣公開的，不算洩漏答案。
      const target = resolvePlaybackTarget(song, question);
      currentSongSource = target?.source ?? null;
      currentSongPlaybackId = target?.idOrUrl ?? null;
      // 只有這場房間本來就是「依主題篩選」時才需要小標顯示，且只列出該首歌「符合本場篩選」的主題
      // （一首歌可能同時屬於多個主題，但只有房主選定的那些才跟這場比賽相關）。
      const matchedThemeNames =
        room.themeFilterIds.length > 0
          ? song.themes
              .filter((st: { themeId: string }) => room.themeFilterIds.includes(st.themeId))
              .map((st: { theme: { name: string } }) => st.theme.name)
          : [];
      currentSongArtist = room.revealed ? song.artist.name : null;
      currentSongThemeLabels = room.revealed ? matchedThemeNames : [];

      // 選擇題搶答模式：讀出這一輪存好的選項 id（見 lib/server/choiceMode.ts），查出對應歌名。
      // 這個清單不受 revealed 影響——選擇題本來就要把所有選項攤在眼前，遮蔽的是「哪個是正解」，
      // 不是選項本身（客戶端點選後由 answer-choice API 判斷對不對，不會直接告訴前端哪個是答案）。
      if (room.answerMode === 'choice') {
        const roundChoiceIds = room.choiceSongIds
          .slice(room.currentRoundIndex * CHOICES_PER_ROUND, (room.currentRoundIndex + 1) * CHOICES_PER_ROUND)
          .filter((id: string) => id.length > 0);
        if (roundChoiceIds.length > 0) {
          const choiceSongs = await prisma.song.findMany({
            where: { id: { in: roundChoiceIds } },
            select: { id: true, title: true },
          });
          const titleById = new Map(choiceSongs.map((s: { id: string; title: string }) => [s.id, s.title]));
          // Prisma 的 findMany({ id: { in: [...] } }) 不保證回傳順序跟輸入陣列一致，
          // 這裡依原本存好、已經洗牌過的 roundChoiceIds 順序重新排列，確保所有玩家看到的選項順序一致。
          currentChoices = roundChoiceIds
            .map((id: string) => ({ songId: id, title: titleById.get(id) }))
            .filter((c: { songId: string; title: string | undefined }): c is { songId: string; title: string } =>
              Boolean(c.title)
            );
        }
      }
    }
  }

  return {
    id: room.id,
    joinCode: room.joinCode,
    mode: room.mode as GameMode,
    answerMode: room.answerMode as RoomState['answerMode'],
    artistFilterIds: room.artistFilterIds,
    themeFilterIds: room.themeFilterIds,
    status: room.status as RoomState['status'],
    roundCount: room.songQueue.length,
    currentRoundIndex: room.currentRoundIndex,
    currentQuestion,
    currentChoices,
    currentSongSource,
    currentSongPlaybackId,
    currentSongArtist,
    currentSongThemeLabels,
    revealed: room.revealed,
    skipVotePlayerIds: room.skipVotePlayerIds,
    lastRevealedTitle: room.lastRevealedTitle,
    lastRevealedArtist: room.lastRevealedArtist,
    lastRevealedThemeLabels: room.lastRevealedThemeLabels,
    lastRevealedAt: room.lastRevealedAt ? room.lastRevealedAt.toISOString() : null,
    roundStartedAt: room.roundStartedAt ? room.roundStartedAt.toISOString() : null,
    hostPlayerId: room.hostPlayerId,
    players: room.players.map((p: { id: string; displayName: string; score: number }) => ({
      id: p.id,
      displayName: p.displayName,
      score: p.score,
    })),
  };
}

/** 產生房間加入用短碼：6 碼大寫英數字，排除容易混淆的字元（0/O、1/I） */
export function generateJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}
