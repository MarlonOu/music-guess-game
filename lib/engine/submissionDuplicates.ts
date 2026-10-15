/**
 * 玩家投稿的重複性檢查（純函式）。
 *
 * 三個比對對象：
 * - 題庫（library）：影片相同或歌名＋歌手相同 → 擋下；只有歌名相同 → 警告。
 * - 待審核投稿（pending）：同上，避免審核區出現一堆重複項目。
 * - 曾被退回的投稿（rejected）：同一支影片 → 警告並附上退回原因。
 * 歌名比對沿用 songMatch 的正規化規則（全半形、大小寫、標點、別名）。
 */
import {
  buildSongMatchIndex,
  findSongMatch,
  type MatchableSong,
  type SongMatch,
} from './songMatch';
import type { DuplicateReason, DuplicateReport } from '../types/submission';

export interface SubmissionCandidate {
  videoId: string;
  /** YouTube 原始標題與頻道（當佐證） */
  rawTitle: string;
  channelTitle: string;
  /** 投稿者確認的歌名與歌手 */
  title: string;
  artistName: string;
}

export interface RejectedRef {
  youtubeVideoId: string;
  title: string;
  artistName: string;
  reviewNote: string;
}

export interface VideoRules {
  embeddable: boolean;
  durationSec: number;
}

export const MIN_DURATION_SEC = 30;
export const MAX_DURATION_SEC = 12 * 60;

function describe(m: SongMatch): { title: string; artist: string } {
  return { title: m.song.title, artist: m.song.artistName };
}

function matchAgainst(songs: MatchableSong[], c: SubmissionCandidate): SongMatch | null {
  if (songs.length === 0) return null;
  return findSongMatch(buildSongMatchIndex(songs), {
    videoId: c.videoId,
    rawTitle: c.rawTitle,
    songTitle: c.title,
    artistName: c.artistName,
    channelTitle: c.channelTitle,
    useRaw: true,
  });
}

export function evaluateDuplicates(
  candidate: SubmissionCandidate,
  library: MatchableSong[],
  pending: MatchableSong[],
  rejected: RejectedRef[],
  rules?: VideoRules
): DuplicateReport {
  const reasons: DuplicateReason[] = [];

  if (rules) {
    if (!rules.embeddable) {
      reasons.push({ code: 'invalid', level: 'block', message: '這支影片不允許嵌入播放，遊戲無法使用。請改投稿其他版本。' });
    }
    if (rules.durationSec > 0 && rules.durationSec < MIN_DURATION_SEC) {
      reasons.push({ code: 'invalid', level: 'block', message: '影片太短（不足 30 秒），不像一首完整的歌。' });
    }
    if (rules.durationSec > MAX_DURATION_SEC) {
      reasons.push({
        code: 'invalid',
        level: 'block',
        message: '影片超過 12 分鐘，看起來是合輯、串燒或演唱會全場，請改投稿單曲版本。',
      });
    }
  }

  const lib = matchAgainst(library, candidate);
  if (lib) {
    if (lib.kind === 'video') {
      reasons.push({ code: 'library-video', level: 'block', message: '題庫已經收錄這支影片。', match: describe(lib) });
    } else if (lib.kind === 'same') {
      reasons.push({
        code: 'library-same',
        level: 'block',
        message: '題庫已經有這首歌（歌名與歌手相符），不需要重複投稿。',
        match: describe(lib),
      });
    } else {
      reasons.push({
        code: 'library-title',
        level: 'warn',
        message: '題庫有歌名相同、但歌手不同的歌曲。若確定是不同的歌，可以繼續送出。',
        match: describe(lib),
      });
    }
  }

  const pen = matchAgainst(pending, candidate);
  if (pen) {
    if (pen.kind === 'video') {
      reasons.push({ code: 'pending-video', level: 'block', message: '已經有人投稿這支影片，正在等待審核。', match: describe(pen) });
    } else if (pen.kind === 'same') {
      reasons.push({
        code: 'pending-same',
        level: 'block',
        message: '已經有人投稿同一首歌，正在等待審核。',
        match: describe(pen),
      });
    } else {
      reasons.push({
        code: 'pending-title',
        level: 'warn',
        message: '審核中有歌名相同、但歌手不同的投稿。',
        match: describe(pen),
      });
    }
  }

  const rej = rejected.find((r) => r.youtubeVideoId === candidate.videoId);
  if (rej) {
    reasons.push({
      code: 'rejected-video',
      level: 'warn',
      message: `這支影片先前投稿過但被退回${rej.reviewNote ? `（原因：${rej.reviewNote}）` : ''}。若已改善再送出。`,
      match: { title: rej.title, artist: rej.artistName },
    });
  }

  const level = reasons.some((r) => r.level === 'block') ? 'block' : reasons.length > 0 ? 'warn' : 'none';
  return { level, reasons };
}
