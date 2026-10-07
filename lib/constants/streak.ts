/**
 * 無限連勝模式：每首歌從隨機片段的起點開始，最多聽 6 段，從 1 秒逐步拉長到 16 秒。
 * 段落秒數呈遞增間隔（1,2,4,7,11,16），前面幾秒的資訊量最珍貴，越早猜中得分越高。
 */
export const STREAK_STAGES_SEC = [1, 2, 4, 7, 11, 16] as const;

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
