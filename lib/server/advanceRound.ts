import { prisma } from '../db';
import { REVEAL_DISPLAY_SEC } from '../constants/roomTiming';

/**
 * 答對（messages route）或全員投票流局（vote-skip route）時呼叫。
 *
 * 核心設計：不是單純把 revealed 設成 true 之後停在原地、等某個客戶端（原本是房主端的本地計時器）
 * 過一段時間再打一次 API 才真的換到下一題。而是「這一刻」就把整個轉換一次做完——
 * 算好下一題是誰、把 currentRoundIndex 推進、把下一題的 roundStartedAt 直接排定成
 * 「現在 + REVEAL_DISPLAY_SEC」。所有客戶端輪詢到這個新狀態時，純粹依 lastRevealedAt／
 * roundStartedAt 這兩個絕對時間戳自己算「現在該顯示公布答案畫面還是已經該倒數下一題」，
 * 不需要依賴任何一個特定客戶端的本地計時器或多一次 API 往返，把「答對→下一題真的開始」
 * 中間疊加的好幾層延遲（輪詢間隔＋計時器＋API 往返＋再一次輪詢間隔）大幅壓縮成只剩
 * 一次輪詢延遲（純粹是「還沒輪詢到最新狀態」的那零點幾秒，無法再更短）。
 *
 * 回傳 true 代表「這次呼叫真的觸發了轉換」；回傳 false 代表房間已經不是預期的那一輪
 * （已經被別的請求搶先推進，例如兩人幾乎同時答對，或答對與投票流局幾乎同時發生）——
 * 呼叫端據此判斷這次是不是真的該記分／不該重複觸發。
 *
 * expectedRoundIndex／expectedRevealed 是樂觀鎖條件：只有房間目前狀態跟呼叫當下讀到的
 * 完全一致，這次 updateMany 才會真的寫入（count === 1），避免競速情況下同一輪被推進兩次。
 */
export async function advanceRoundAfterReveal(roomId: string, expectedRoundIndex: number): Promise<boolean> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.currentRoundIndex !== expectedRoundIndex || room.revealed) return false;

  const revealedSongId = room.songQueue[room.currentRoundIndex];
  const revealedSong = revealedSongId
    ? await prisma.song.findUnique({
        where: { id: revealedSongId },
        include: { artist: true, themes: { include: { theme: true } } },
      })
    : null;

  // 只有這場房間本來就是「依主題篩選」時才需要小標，且只列出符合本場篩選的主題（理由同 roomState.ts）
  const lastRevealedThemeLabels =
    revealedSong && room.themeFilterIds.length > 0
      ? revealedSong.themes
          .filter((st: { themeId: string }) => room.themeFilterIds.includes(st.themeId))
          .map((st: { theme: { name: string } }) => st.theme.name)
      : [];

  const nextIndex = room.currentRoundIndex + 1;
  const now = new Date();
  const isLastRound = nextIndex >= room.songQueue.length;

  const result = await prisma.room.updateMany({
    where: { id: roomId, currentRoundIndex: expectedRoundIndex, revealed: false },
    data: isLastRound
      ? {
          status: 'finished',
          revealed: true,
          lastRevealedTitle: revealedSong?.title ?? null,
          lastRevealedArtist: revealedSong?.artist.name ?? null,
          lastRevealedThemeLabels,
          lastRevealedAt: now,
        }
      : {
          currentRoundIndex: nextIndex,
          revealed: false,
          skipVotePlayerIds: [],
          roundStartedAt: new Date(now.getTime() + REVEAL_DISPLAY_SEC * 1000),
          lastRevealedTitle: revealedSong?.title ?? null,
          lastRevealedArtist: revealedSong?.artist.name ?? null,
          lastRevealedThemeLabels,
          lastRevealedAt: now,
        },
  });

  return result.count === 1;
}
