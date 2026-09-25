/**
 * 歌曲清單 CSV 標準格式。欄位順序固定，匯出／匯入共用同一份定義，避免兩邊各寫一套漏同步。
 *
 * 設計原則：
 * - 用「歌手名稱」「主題名稱」而非內部 id，方便直接用 Excel／試算表編輯，
 *   匯入時找不到對應名稱會自動新增歌手／主題，不會因為 id 對不上而失敗。
 * - 不含 id／createdAt 這種內部欄位，匯入時一律由系統決定；
 *   同一支 youtubeVideoId／appleMusicPreviewUrl／deezerPreviewUrl 視為同一首歌（去重鍵之一），
 *   已存在就更新，不存在才新增；三者都沒有的話，退回用「歌名＋歌手」比對是否重複
 *   （見匯入 API 的說明）。
 * - youtubeVideoId／appleMusicTrackId／appleMusicPreviewUrl／deezerTrackId／deezerPreviewUrl
 *   五欄都可以留空，但 youtubeVideoId／appleMusicPreviewUrl／deezerPreviewUrl 三者至少要有
 *   一欄有值，這首歌才有得播放。
 * - appleMusicSkip／deezerSkip 是「管理者已確認這個平台真的找不到這首歌（或找到的都不對），
 *   批次腳本（scripts/fetch-apple-previews.mjs、fetch-deezer-previews.mjs）不要再自動幫這首歌
 *   搜尋補上來源」的標記，值為 "true" 才算勾選，其餘（空白／"false"／任何其他字串）都當作
 *   未勾選。這兩欄存在的理由：appleMusicPreviewUrl／deezerPreviewUrl 留空這件事本身沒辦法
 *   分辨「還沒查過」跟「查過了、確認沒有、管理者刻意留空」，兩者存起來長得一模一樣，
 *   沒有這個獨立標記的話，重新跑一次批次腳本就會把管理者刻意清空的欄位又填回錯誤的比對結果。
 * - themes 欄位多個主題用「;」分隔（CSV 本身已用「,」分隔欄位，同一欄內不能再用逗號）。
 */
export const SONG_CSV_COLUMNS = [
  'title',
  'artist',
  'youtubeVideoId',
  'appleMusicTrackId',
  'appleMusicPreviewUrl',
  'appleMusicSkip',
  'deezerTrackId',
  'deezerPreviewUrl',
  'deezerSkip',
  'durationSec',
  'themes',
  'lyrics',
] as const;

export type SongCsvRow = {
  title: string;
  artist: string;
  youtubeVideoId: string;
  appleMusicTrackId: string;
  appleMusicPreviewUrl: string;
  appleMusicSkip: string;
  deezerTrackId: string;
  deezerPreviewUrl: string;
  deezerSkip: string;
  durationSec: string;
  themes: string;
  lyrics: string;
};

export const THEME_LIST_SEPARATOR = ';';
