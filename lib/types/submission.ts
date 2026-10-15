export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

/** 重複性檢查的單筆結果 */
export interface DuplicateReason {
  code:
    | 'library-video' // 題庫已有同一支影片
    | 'library-same' // 題庫已有同歌名＋同歌手
    | 'library-title' // 題庫已有同歌名、不同歌手
    | 'pending-video' // 已有人投稿同一支影片，待審核
    | 'pending-same' // 待審核中已有同歌名＋同歌手
    | 'pending-title'
    | 'rejected-video' // 同一支影片曾被退回
    | 'invalid'; // 影片本身不符合（不可嵌入、長度不合理等）
  /** block：不能送出；warn：可送出，但要先確認 */
  level: 'block' | 'warn';
  message: string;
  /** 對上的既有歌曲或投稿 */
  match?: { title: string; artist: string };
}

export interface DuplicateReport {
  /** 最嚴重的等級：none 代表沒有任何問題 */
  level: 'none' | 'warn' | 'block';
  reasons: DuplicateReason[];
}

export interface VideoInfo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSec: number;
  embeddable: boolean;
}

export interface SubmissionCheckResponse {
  video: VideoInfo;
  suggestion: { title: string; artist: string };
  report: DuplicateReport;
}

export interface SongSubmissionView {
  id: string;
  youtubeVideoId: string;
  videoTitle: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSec: number;
  title: string;
  artistName: string;
  note: string;
  submitterName: string;
  status: SubmissionStatus;
  warning: string;
  reviewNote: string;
  songId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** 管理端列表才有：以目前題庫即時重算的重複性檢查 */
  report?: DuplicateReport;
}
