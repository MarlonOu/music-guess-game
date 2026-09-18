/**
 * 歌曲清單 CSV 標準格式。欄位順序固定，匯出／匯入共用同一份定義，避免兩邊各寫一套漏同步。
 *
 * 設計原則：
 * - 用「歌手名稱」「主題名稱」而非內部 id，方便直接用 Excel／試算表編輯，
 *   匯入時找不到對應名稱會自動新增歌手／主題，不會因為 id 對不上而失敗。
 * - 不含 id／createdAt 這種內部欄位，匯入時一律由系統決定；
 *   同一支 youtubeVideoId 或 appleMusicPreviewUrl 視為同一首歌（去重鍵之一），已存在就更新，
 *   不存在才新增；兩者都沒有的話，退回用「歌名＋歌手」比對是否重複（見匯入 API 的說明）。
 * - youtubeVideoId／appleMusicTrackId／appleMusicPreviewUrl 三欄都可以留空，但
 *   youtubeVideoId 與 appleMusicPreviewUrl 至少要有一欄有值，這首歌才有得播放。
 * - themes 欄位多個主題用「;」分隔（CSV 本身已用「,」分隔欄位，同一欄內不能再用逗號）。
 */
export const SONG_CSV_COLUMNS = [
  'title',
  'artist',
  'youtubeVideoId',
  'appleMusicTrackId',
  'appleMusicPreviewUrl',
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
  durationSec: string;
  themes: string;
  lyrics: string;
};

export const THEME_LIST_SEPARATOR = ';';
