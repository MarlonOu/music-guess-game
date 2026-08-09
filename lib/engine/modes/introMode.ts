import type { Song } from '../../types/song';
import type { GameModeStrategy, QuestionPayload } from '../../types/question';
import { isAnswerCorrect } from '../answerUtils';

// 前奏猜歌模式固定播放秒數，所有歌曲一致，不再由每首歌各自的 introEndSec 決定。
export const FIXED_INTRO_DURATION_SEC = 15;

export const introMode: GameModeStrategy = {
  renderQuestionType: 'audio-intro',

  prepareQuestion(song: Song): QuestionPayload {
    return {
      songId: song.id,
      renderType: 'audio-intro',
      introEndSec: FIXED_INTRO_DURATION_SEC,
      correctTitle: song.title,
    };
  },

  judgeAnswer(payload: QuestionPayload, userAnswer: string): boolean {
    return isAnswerCorrect(userAnswer, payload.correctTitle);
  },
};
