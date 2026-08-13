export interface Song {
  id: string;
  title: string;
  artistId: string;
  /** @deprecated 播放已改用 YouTube IFrame Player（見 youtubeVideoId），保留供未來自架 CDN 音檔備援方案使用 */
  audioUrl?: string;
  /** YouTube 影片 ID（非完整網址），例如 "dQw4w9WgXcQ"，供 AudioController 播放使用 */
  youtubeVideoId: string;
  durationSec: number;
  lyrics: string;
  createdAt: string;
  /** 這首歌所屬的主題 id 清單（男歌手、90年代金曲等），供主題篩選使用 */
  themeIds: string[];
}

export interface SongFilter {
  artistIds?: string[];
  themeIds?: string[];
}
