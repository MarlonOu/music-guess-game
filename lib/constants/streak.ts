/**
 * 無限連勝模式：每首歌從隨機片段的起點開始，最多聽 6 段，在 0~20 秒內逐步拉長。
 * 段落秒數（累計）為 2、4、7、11、15、20：第一段就有 2 秒可以抓到旋律，最後一段 20 秒，
 * 越早猜中得分越高。
 */
export const STREAK_STAGES_SEC = [2, 4, 7, 11, 15, 20] as const;

/** 隨機片段的長度：等於最後一段的秒數，確保每一段都落在同一個片段之內。 */
export const STREAK_CLIP_SEC = STREAK_STAGES_SEC[STREAK_STAGES_SEC.length - 1];

/** 在第 stageIndex 段（0 起算）猜中的得分：第 1 段 6 分，最後一段 1 分。 */
export function streakPointsForStage(stageIndex: number): number {
  return STREAK_STAGES_SEC.length - stageIndex;
}

export const STREAK_BEST_STORAGE_KEY = 'streak-best-v1';
/** 排行榜暱稱在這台裝置上的記憶 key（與速通共用，避免每次都要重打） */
export const PLAYER_NAME_STORAGE_KEY = 'player-name-v1';

/** 每一段送出後，伺服器至少要等這麼久才接受猜測（毫秒），防止程式毫秒級連續作答。 */
export const STREAK_MIN_GUESS_MS = 1200;

/** Apple／Deezer 官方試聽片段的長度（秒），伺服器在其中隨機挑片段起點。 */
export const STREAK_PREVIEW_LEN_SEC = 30;
