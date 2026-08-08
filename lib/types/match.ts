export type GameMode = 'INTRO' | 'RANDOM_CLIP' | 'LYRIC_LINE';

export interface Match {
  id: string;
  mode: GameMode;
  artistFilterIds: string[];
  themeFilterIds: string[];
  roundCount: number;
  createdAt: string;
}

export interface MatchPlayer {
  matchId: string;
  playerId: string;
  score: number;
}

export interface Round {
  id: string;
  matchId: string;
  songId: string;
  clipStartSec?: number;
  lyricLineIndex?: number;
  order: number;
}
