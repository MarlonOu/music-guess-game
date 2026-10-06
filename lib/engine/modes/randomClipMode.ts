import type { Song } from '../../types/song';
import type { GameModeStrategy, QuestionPayload } from '../../types/question';
import { isAnswerCorrect } from '../answerUtils';

/** 隨機片段長度（秒），與 Apple Music / Deezer 官方試聽片段的 30 秒對齊。 */
export const DEFAULT_CLIP_DURATION_SEC = 30;

/** 片段起點避開頭尾的邊界範圍（秒）。MV 常有片頭空白、片尾淡出或字幕，頭尾各隨機避開 10~20 秒。 */
export const CLIP_EDGE_MARGIN_MIN_SEC = 10;
export const CLIP_EDGE_MARGIN_MAX_SEC = 20;

/**
 * 計算隨機片段起始秒數。
 * 輸入：歌曲總長（durationSec）、片段長度（clipDurationSec）
 * 輸出：整數秒，保證 clip 不超出歌曲長度，且盡量避開頭尾各 10~20 秒（頭尾邊界各自隨機）。
 * 邊界條件：
 * - durationSec 小於等於 clipDurationSec：起始秒數固定為 0（整首播放）
 * - 歌曲太短、扣掉頭尾邊界後沒有空間時：邊界縮小為可用空間的 1/4，仍保留一個居中的隨機範圍
 * @param random 可注入的亂數來源（預設 Math.random），方便測試
 */
export function getRandomClipStart(
  durationSec: number,
  clipDurationSec: number,
  random: () => number = Math.random
): number {
  if (durationSec <= clipDurationSec) return 0;
  const slack = durationSec - clipDurationSec;
  const span = CLIP_EDGE_MARGIN_MAX_SEC - CLIP_EDGE_MARGIN_MIN_SEC;
  let head = CLIP_EDGE_MARGIN_MIN_SEC + Math.floor(random() * (span + 1));
  let tail = CLIP_EDGE_MARGIN_MIN_SEC + Math.floor(random() * (span + 1));
  if (head + tail >= slack) {
    head = Math.floor(slack / 4);
    tail = Math.floor(slack / 4);
  }
  const minStart = head;
  const maxStart = slack - tail;
  return minStart + Math.floor(random() * (maxStart - minStart + 1));
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
      aliases: song.aliases,
    };
  },

  judgeAnswer(payload: QuestionPayload, userAnswer: string): boolean {
    return isAnswerCorrect(userAnswer, payload.correctTitle, payload.aliases);
  },
};
