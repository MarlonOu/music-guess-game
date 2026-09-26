/**
 * 版本／技術性標記關鍵字：出現在歌名結尾括號裡、符合這份清單的，視為「這只是在說明這是哪個
 * 版本」而不是歌名本身有意義的一部分，比對答案時可以放心剝掉——不管剝不剝，剩下的部分永遠都是
 * 「正確的完整歌名」，這是這份清單能安全自動化的前提。
 *
 * 刻意只列「明確是版本/技術性標記」的關鍵字，不是「看到括號就剝」：很多歌名的括號內容是官方
 * 標題真正的一部分（例如「好好（想把你寫成一首歌）」），剝掉會把歌名剝壞、答案反而變得不完整。
 * 這兩種情況沒辦法只憑「有沒有括號」這個格式特徵分辨，只能認關鍵字——遇到清單以外、
 * 判斷不出來是不是版本標記的括號內容，一律保留不剝，交給下面的別名清單（aliases）由管理者
 * 手動決定「這首歌還有哪些說法也算對」，那才是真正需要人判斷的情況，不該讓自動規則猜。
 */
const VERSION_MARKER_KEYWORDS = [
  'live',
  'demo',
  'remix',
  'acoustic',
  'unplugged',
  'instrumental',
  'reprise',
  'radio edit',
  'extended',
  'remaster(?:ed)?',
  'karaoke',
  'cover',
  'feat\\.?',
  'ft\\.?',
  '女生版',
  '男生版',
  '純音樂',
  '伴奏',
  '重製',
  '重新混音',
  '翻唱',
  '現場版',
  '演唱會版',
  'mv',
];

// 比對「結尾的括號（半形或全形）裡面含有上述任一關鍵字」，可以出現在字串中間有其他文字之後，
// 但整個括號要在字串最後面（結尾標記，不是隨便哪裡出現都剝）。大小寫不拘。
const VERSION_MARKER_PATTERN = new RegExp(
  `[\\(\\uFF08][^()\\uFF08\\uFF09]*(?:${VERSION_MARKER_KEYWORDS.join('|')})[^()\\uFF08\\uFF09]*[\\)\\uFF09]\\s*$`,
  'i'
);

/**
 * 反覆剝掉字串結尾符合版本標記的括號，直到剝不動為止（處理「歌名 (Live)（2023 Remaster）」
 * 這種疊了好幾層標記的情況）。剝到中間才會停：一旦結尾的括號內容不符合關鍵字清單，
 * 就算後面還有其他括號也不再繼續剝，避免不小心剝進歌名真正的一部分。
 */
function stripVersionMarkers(title: string): string {
  let result = title.trim();
  // 設一個上限次數而不是單純 while(true)，避免正規表示式規則寫錯導致無窮迴圈掛住整個請求
  for (let i = 0; i < 5; i++) {
    const stripped = result.replace(VERSION_MARKER_PATTERN, '').trim();
    if (stripped === result) break;
    result = stripped;
  }
  return result;
}

/**
 * 正規化使用者輸入與正確答案，統一比對規則：
 * - 移除頭尾空白
 * - 轉為小寫（處理英文歌名大小寫差異）
 * - 移除全形/半形空白差異（歌名中間的空白視為可忽略）
 * - 剝掉結尾的版本/技術性標記括號（見 stripVersionMarkers 的說明）
 */
function normalizeAnswer(raw: string): string {
  return stripVersionMarkers(raw)
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '');
}

/**
 * 判定使用者輸入是否為正確答案。除了 title 本身，也接受 aliases（別名清單，見
 * lib/types/song.ts 的欄位說明）裡任何一筆——命中任何一個就算對，不要求同時符合多筆。
 *
 * 刻意不做「輸入是正確答案的子字串就算對」這種部分比對：那樣任何單字都可能誤中一堆
 * 不相關的歌名，等於讓遊戲失去鑑別度。這裡永遠是「跟某一筆完整的可接受答案（title 或某個
 * alias）正規化後完全相符」，只是「可接受答案」的清單從單一 title 擴大成 title + aliases。
 */
export function isAnswerCorrect(userAnswer: string, correctTitle: string, aliases: string[] = []): boolean {
  if (!userAnswer) return false;
  const normalizedAnswer = normalizeAnswer(userAnswer);
  if (normalizedAnswer === normalizeAnswer(correctTitle)) return true;
  return aliases.some((alias) => normalizedAnswer === normalizeAnswer(alias));
}
