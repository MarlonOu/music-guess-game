/**
 * 無限連勝模式：每首歌最多聽 6 段，從 1 秒開始逐步拉長到 16 秒。
 * 段落秒數呈遞增間隔（1,2,4,7,11,16），前面幾秒的資訊量最珍貴，越早猜中得分越高。
 */
export const STREAK_STAGES_SEC = [1, 2, 4, 7, 11, 16] as const;

/** 在第 stageIndex 段（0 起算）猜中的得分：第 1 段 6 分，最後一段 1 分。 */
export function streakPointsForStage(stageIndex: number): number {
  return STREAK_STAGES_SEC.length - stageIndex;
}

export const STREAK_BEST_STORAGE_KEY = 'streak-best-v1';
