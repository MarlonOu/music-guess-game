import type { AudioSource, PlayFallback } from '../audio/audioController';

/** 目前這一段要播放的資訊。不含歌名與答案。 */
export interface StreakPlayback {
  source: AudioSource;
  idOrUrl: string;
  /** 片段起點（YouTube 為隨機片段的起點；Apple／Deezer 試聽固定從 0 開始） */
  startSec: number;
  /** 這一段要播多久 */
  durationSec: number;
  fallback: PlayFallback | null;
}

export interface StreakQuestion {
  /** 這是第幾首（1 起算） */
  number: number;
  /** 目前解鎖到第幾段（0 起算） */
  stage: number;
  wrong: string[];
  playback: StreakPlayback;
}

/** 題目結束（答對或失敗）後才會揭露的答案資訊 */
export interface StreakAnswer {
  songId: string;
  title: string;
  artist: string;
  /** 公布答案後用來播出整首歌（從片段起點開始，不限長度） */
  reveal: StreakPlayback | null;
}

export interface StreakStartResponse {
  token: string;
  question: StreakQuestion;
}

export interface StreakGuessResponse {
  result: 'correct' | 'wrong' | 'failed';
  /** result 為 wrong 時：已解鎖的下一段題目 */
  question?: StreakQuestion;
  /** result 為 correct 或 failed 時：公布的答案 */
  answer?: StreakAnswer;
  /** 答錯時伺服器認定的猜測文字（顯示在「猜錯」清單） */
  guessLabel?: string;
  gain?: number;
  streak: number;
  score: number;
  /** failed 代表挑戰結束，需要送出成績 */
  over: boolean;
}

export interface StreakNextResponse {
  /** 題庫全部猜完時沒有下一題，挑戰直接結束 */
  question: StreakQuestion | null;
  over: boolean;
  streak: number;
  score: number;
}

export interface StreakLeaderboardEntry {
  id: string;
  displayName: string;
  streak: number;
  score: number;
}

export interface StreakSubmitResponse {
  streak: number;
  score: number;
  rank: number;
  totalRuns: number;
  scoreId: string;
  leaderboard: StreakLeaderboardEntry[];
}
