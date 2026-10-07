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
  /** 播放用的穩定站內路徑（由伺服器依 track id 即時解析最新試聽網址）；有值時一律優先於 deezerPreviewUrl，
   *  因為 Deezer 的試聽網址帶時效簽章，存在資料庫的網址會過期。後台編輯仍然只使用 deezerPreviewUrl／deezerTrackId。 */
  deezerPlayUrl?: string;
  /** 管理者已確認 Apple Music 上真的找不到這首歌（或找到的都不對），批次腳本應跳過不要自動搜尋 */
  appleMusicSkip: boolean;
  /** 同上，給 Deezer 用 */
  deezerSkip: boolean;
  /** 管理者已人工核對過目前的 Apple Music 來源就是正確版本，批次腳本 --force 重新整理過期
   *  網址時要跳過這首歌，不能重新搜尋覆蓋（見 lib/csv/songCsv.ts 的完整說明） */
  appleMusicVerified: boolean;
  /** 同上，給 Deezer 用 */
  deezerVerified: boolean;
  /** 這首歌其他也算答對的說法（別名清單），見 lib/engine/answerUtils.ts 的比對邏輯說明 */
  aliases: string[];
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
