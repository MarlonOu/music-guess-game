import type { Song } from './song';

export type RenderQuestionType = 'audio-intro' | 'audio-clip' | 'text-lyric';

export interface QuestionPayload {
  songId: string;
  renderType: RenderQuestionType;
  // INTRO 模式：播放 0 到 introEndSec
  introEndSec?: number;
  // RANDOM_CLIP 模式：播放 clipStartSec 到 clipStartSec + clipDurationSec
  clipStartSec?: number;
  clipDurationSec?: number;
  // LYRIC_LINE 模式：抽取的單行歌詞文字與索引
  lyricLineText?: string;
  lyricLineIndex?: number;
  correctTitle: string;
}

export interface GameModeStrategy {
  prepareQuestion(song: Song): QuestionPayload;
  renderQuestionType: RenderQuestionType;
  judgeAnswer(payload: QuestionPayload, userAnswer: string): boolean;
}
