import type { Song } from '../../types/song';
import type { GameModeStrategy, QuestionPayload } from '../../types/question';
import { isAnswerCorrect } from '../answerUtils';

export const introMode: GameModeStrategy = {
  renderQuestionType: 'audio-intro',

  prepareQuestion(song: Song): QuestionPayload {
    return {
      songId: song.id,
      renderType: 'audio-intro',
      introEndSec: song.introEndSec,
      correctTitle: song.title,
    };
  },

  judgeAnswer(payload: QuestionPayload, userAnswer: string): boolean {
    return isAnswerCorrect(userAnswer, payload.correctTitle);
  },
};
