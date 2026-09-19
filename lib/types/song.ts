export interface Song {
  id: string;
  title: string;
  artistId: string;
  /** @deprecated 播放已改用 YouTube IFrame Player（見 youtubeVideoId），保留供未來自架 CDN 音檔備援方案使用 */
  audioUrl?: string;
  /** YouTube 影片 ID（非完整網址），例如 "dQw4w9WgXcQ"。跟 appleMusicPreviewUrl 至少要有一個存在，
   *  兩者都有時播放優先選 appleMusicPreviewUrl（理由見 lib/audio/resolvePlaybackTarget.ts）。 */
  youtubeVideoId?: string;
  /** iTunes/Apple Music 的 track id，供重新查詢／核對用；實際播放不用這個欄位 */
  appleMusicTrackId?: string;
  /** Apple Music 官方 30 秒試聽片段的直接可播放網址，播放時第一優先使用這個來源 */
  appleMusicPreviewUrl?: string;
  /** Deezer 的 track id，供重新查詢／核對用；實際播放不用這個欄位 */
  deezerTrackId?: string;
  /** Deezer 官方 30 秒試聽片段的直接可播放網址，Apple Music 沒有這首歌時的第二優先來源 */
  deezerPreviewUrl?: string;
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
