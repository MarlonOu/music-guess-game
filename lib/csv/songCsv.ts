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
 * - appleMusicVerified／deezerVerified 是跟上面兩個「互補」但不同的標記：「管理者已經人工
 *   核對過，目前這個來源就是正確版本」（例如自動比對原本抓到翻唱版/remix，管理者手動改成
 *   正確的網址），值為 "true" 才算勾選。這兩欄存在的理由：批次腳本有個 --force 參數可以
 *   重新搜尋、刷新「已經有值、但可能因為時間久了失效過期」的試聽網址（Apple/Deezer 的
 *   試聽網址都是有時效性的簽章網址，不是永久有效）——但如果某首歌的來源是管理者手動
 *   核對修正過的，--force 重新搜尋反而有風險把它蓋回原本錯誤的自動比對結果，因為搜尋演算法
 *   沒有變，多半還是會找到同一個「最佳匹配」，也就是原本那個錯的。標記為已核對的歌曲，
 *   --force 也一律跳過，不去動它。
 * - aliases 是「這首歌其他也算答對的說法」（別名清單），用來處理歌名有多種常見叫法的情況
 *   （中英合併標題的簡稱、純英文譯名、常見暱稱、繁簡體差異等），見
 *   lib/engine/answerUtils.ts 的比對邏輯說明。多筆別名用「;」分隔，跟 themes 欄位一樣。
 * - themes／aliases 這兩欄多個值都用「;」分隔（CSV 本身已用「,」分隔欄位，同一欄內不能再用逗號）。
 */
export const SONG_CSV_COLUMNS = [
  'title',
  'artist',
  'aliases',
  'youtubeVideoId',
  'appleMusicTrackId',
  'appleMusicPreviewUrl',
  'appleMusicSkip',
  'appleMusicVerified',
  'deezerTrackId',
  'deezerPreviewUrl',
  'deezerSkip',
  'deezerVerified',
  'durationSec',
  'themes',
  'lyrics',
] as const;

export type SongCsvRow = {
  title: string;
  artist: string;
  aliases: string;
  youtubeVideoId: string;
  appleMusicTrackId: string;
  appleMusicPreviewUrl: string;
  appleMusicSkip: string;
  appleMusicVerified: string;
  deezerTrackId: string;
  deezerPreviewUrl: string;
  deezerSkip: string;
  deezerVerified: string;
  durationSec: string;
  themes: string;
  lyrics: string;
};

export const THEME_LIST_SEPARATOR = ';';
/** aliases 欄位多筆別名的分隔符，跟 THEME_LIST_SEPARATOR 用同一個符號，維持 CSV 裡「多值欄位」的慣例一致 */
export const ALIAS_LIST_SEPARATOR = ';';
