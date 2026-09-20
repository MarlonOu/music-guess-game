import type { AudioSource } from '../audio/audioController';

export interface SpeedrunChoice {
  songId: string;
  title: string;
}

/** 單一題目的播放資訊與選項。不含「哪個選項是正解」——這個真相只存在伺服器記憶體裡（見 lib/server/speedrunSession.ts） */
export interface SpeedrunQuestion {
  source: AudioSource | null;
  playbackId: string | null;
  startSec: number;
  durationSec?: number;
  choices: SpeedrunChoice[];
}

export interface SpeedrunStartResponse {
  token: string;
  questions: SpeedrunQuestion[];
}

export interface SpeedrunCheckResponse {
  correct: boolean;
  /** 這題答對之後，是不是整場挑戰的最後一題（全部 10 題都答對了） */
  finished: boolean;
  /** 只有 finished 為 true 時才有值：伺服器算出的總耗時（毫秒） */
  totalTimeMs: number | null;
}

export interface SpeedrunLeaderboardEntry {
  id: string;
  displayName: string;
  totalTimeMs: number;
}

export interface SpeedrunSubmitResponse {
  totalTimeMs: number;
  /** 這次成績在全站排行榜的名次（1 起算） */
  rank: number;
  /** 排行榜目前總共有幾筆成績 */
  totalRuns: number;
  scoreId: string;
  leaderboard: SpeedrunLeaderboardEntry[];
}
