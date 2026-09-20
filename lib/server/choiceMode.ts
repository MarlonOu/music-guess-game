/** 選擇題搶答模式（answerMode='choice'）每一輪顯示的選項數量（含正確答案） */
export const CHOICES_PER_ROUND = 4;

interface CandidateSong {
  id: string;
  title: string;
  artistId: string;
  themeIds: string[];
}

/**
 * 為一首正確答案的歌曲，從候選歌曲池中挑出干擾選項（不含正確答案本身）。
 *
 * 優先序（越前面越優先，直到湊滿需要的數量）：
 * 1. 跟正確答案「共用至少一個主題」的其他歌曲——這是選擇題搶答要「防作弊」的關鍵：
 *    干擾選項要跟正確答案夠像（同類型、同曲風），單純亂數選完全不相關的歌曲當干擾選項，
 *    選擇題會變成送分題，沒有鑑別度。
 * 2. 湊不滿的話，退而求其次找「同一位歌手」的其他歌曲。
 * 3. 還是湊不滿，最後從整個候選池隨機挑其餘的歌曲頂著（總比選項不夠、選擇題開天窗好）。
 *
 * 每一階段內部都用亂數洗牌後再取用，避免每次都選到候選池裡排序最前面的固定幾首。
 */
export function pickDecoyIds(correctSong: CandidateSong, pool: CandidateSong[], count: number): string[] {
  const otherSongs = pool.filter((s) => s.id !== correctSong.id);
  const picked: string[] = [];
  const pickedSet = new Set<string>();

  function addFrom(candidates: CandidateSong[]) {
    if (picked.length >= count) return;
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    for (const c of shuffled) {
      if (picked.length >= count) break;
      if (pickedSet.has(c.id)) continue;
      picked.push(c.id);
      pickedSet.add(c.id);
    }
  }

  const correctThemeIds = new Set(correctSong.themeIds);
  const sameTheme = otherSongs.filter((s) => s.themeIds.some((t) => correctThemeIds.has(t)));
  addFrom(sameTheme);

  if (picked.length < count) {
    const sameArtist = otherSongs.filter((s) => s.artistId === correctSong.artistId);
    addFrom(sameArtist);
  }

  if (picked.length < count) {
    addFrom(otherSongs);
  }

  return picked;
}

/**
 * 為一整場比賽的每一輪各自計算選擇題選項（正確答案 + 干擾選項），洗牌後攤平回傳成一維陣列，
 * 對應 Room.choiceSongIds 的儲存格式：第 N 輪的選項落在
 * [N * CHOICES_PER_ROUND, (N+1) * CHOICES_PER_ROUND) 這個區間。
 *
 * pool 應該是「這場房間篩選條件下的完整候選歌曲池」（不只是抽到的那幾首），這樣干擾選項才有
 * 足夠的素材可以挑，也才能維持「跟正確答案同主題/同歌手」這個機制的意義——如果候選池只有
 * 抽到的那幾首歌，干擾選項的挑選空間會太小，題庫小的房間甚至可能湊不滿。
 */
export function buildChoiceSongIds(songQueue: CandidateSong[], pool: CandidateSong[]): string[] {
  const flat: string[] = [];
  for (const correctSong of songQueue) {
    const decoyIds = pickDecoyIds(correctSong, pool, CHOICES_PER_ROUND - 1);
    const roundChoiceIds = [correctSong.id, ...decoyIds];
    // 這裡才洗牌決定選項在畫面上的顯示順序，不然正確答案永遠排第一個，形同沒有選擇題的意義
    const shuffled = [...roundChoiceIds].sort(() => Math.random() - 0.5);
    // 選項數量不足 CHOICES_PER_ROUND 時（候選池太小），補空字串佔位；讀取端需要濾掉空字串，
    // 不會因為選項數量不齊而整輪出錯，純粹是選項會比預期少幾個。
    while (shuffled.length < CHOICES_PER_ROUND) shuffled.push('');
    flat.push(...shuffled);
  }
  return flat;
}
