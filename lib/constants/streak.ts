/**
 * 無限連勝模式：每首歌從隨機片段的起點開始，最多聽 6 段，在 0~20 秒內逐步拉長。
 * 段落秒數（累計）為 1、2、4、8、13、20：前兩段固定是 1 秒與 2 秒（前奏一入耳就認出來最厲害），
 * 之後每段多給的秒數逐步增加（+2、+4、+5、+7），最後一段完整 20 秒。
 */
export const STREAK_STAGES_SEC = [1, 2, 4, 8, 13, 20] as const;

/** 隨機片段的長度：等於最後一段的秒數，確保每一段都落在同一個片段之內。 */
export const STREAK_CLIP_SEC = STREAK_STAGES_SEC[STREAK_STAGES_SEC.length - 1];

/**
 * 各段猜中的得分。越早猜中獎勵越重：1 秒猜中 10 分，2 秒 7 分，之後 5、3、2、1。
 * 前兩段刻意拉開差距，鼓勵憑極短片段辨認，最後一段仍保底 1 分，維持連勝的意義。
 */
export const STREAK_POINTS_BY_STAGE = [10, 7, 5, 3, 2, 1] as const;

/** 在第 stageIndex 段（0 起算）猜中的得分。 */
export function streakPointsForStage(stageIndex: number): number {
  return STREAK_POINTS_BY_STAGE[Math.min(stageIndex, STREAK_POINTS_BY_STAGE.length - 1)];
}

export const STREAK_BEST_STORAGE_KEY = 'streak-best-v1';
/** 排行榜暱稱在這台裝置上的記憶 key（與速通共用，避免每次都要重打） */
export const PLAYER_NAME_STORAGE_KEY = 'player-name-v1';

/** 每一段送出後，伺服器至少要等這麼久才接受猜測（毫秒），防止程式毫秒級連續作答。 */
export const STREAK_MIN_GUESS_MS = 1200;

/** Apple／Deezer 官方試聽片段的長度（秒），伺服器在其中隨機挑片段起點。 */
export const STREAK_PREVIEW_LEN_SEC = 30;
