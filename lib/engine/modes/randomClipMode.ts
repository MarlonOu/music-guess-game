import type { Song } from '../../types/song';
import type { GameModeStrategy, QuestionPayload } from '../../types/question';
import { isAnswerCorrect } from '../answerUtils';

export const DEFAULT_CLIP_DURATION_SEC = 8;

/**
 * 計算隨機片段起始秒數。
 * 輸入：歌曲總長（durationSec）、片段長度（clipDurationSec）
 * 輸出：0 到 (durationSec - clipDurationSec) 之間的整數秒
 * 邊界條件：
 * - 若 durationSec 小於等於 clipDurationSec，起始秒數固定為 0（整首播放）
 * - 回傳值需保證 clip 不超出歌曲長度
 */
export function getRandomClipStart(durationSec: number, clipDurationSec: number): number {
  if (durationSec <= clipDurationSec) return 0;
  const maxStart = durationSec - clipDurationSec;
  return Math.floor(Math.random() * (maxStart + 1));
}

export const randomClipMode: GameModeStrategy = {
  renderQuestionType: 'audio-clip',

  prepareQuestion(song: Song): QuestionPayload {
    // 防護：durationSec 若為 0 或缺漏（例如資料輸入疏漏），無法算出合理片段長度，
    // 退回固定的預設片段長度，避免片段長度算成 0 秒導致播放器立刻自動暫停。
    const effectiveDuration = song.durationSec > 0 ? song.durationSec : DEFAULT_CLIP_DURATION_SEC;
    const clipDurationSec = Math.min(DEFAULT_CLIP_DURATION_SEC, effectiveDuration);
    return {
      songId: song.id,
      renderType: 'audio-clip',
      clipStartSec: getRandomClipStart(effectiveDuration, clipDurationSec),
      clipDurationSec,
      correctTitle: song.title,
    };
  },

  judgeAnswer(payload: QuestionPayload, userAnswer: string): boolean {
    return isAnswerCorrect(userAnswer, payload.correctTitle);
  },
};
