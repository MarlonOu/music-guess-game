import type { Song } from '../../types/song';
import type { GameModeStrategy, QuestionPayload } from '../../types/question';
import { isAnswerCorrect } from '../answerUtils';

/**
 * 從完整歌詞抽取單一行。
 * 輸入：歌詞全文（以換行分隔）
 * 輸出：{ line, index }，index 對應「非空白行」過濾後的陣列索引
 * 邊界條件：
 * - 過濾空白行，避免抽到空字串
 * - 若過濾後無任何行，回傳 index -1、line 為空字串
 */
export function pickRandomLyricLine(lyrics: string): { line: string; index: number } {
  const lines = lyrics
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { line: '', index: -1 };
  }

  const index = Math.floor(Math.random() * lines.length);
  return { line: lines[index], index };
}

export const lyricLineMode: GameModeStrategy = {
  renderQuestionType: 'text-lyric',

  prepareQuestion(song: Song): QuestionPayload {
    const { line, index } = pickRandomLyricLine(song.lyrics);
    return {
      songId: song.id,
      renderType: 'text-lyric',
      lyricLineText: line,
      lyricLineIndex: index,
      correctTitle: song.title,
    };
  },

  judgeAnswer(payload: QuestionPayload, userAnswer: string): boolean {
    return isAnswerCorrect(userAnswer, payload.correctTitle);
  },
};
