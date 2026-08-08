/**
 * 正規化使用者輸入與正確答案，統一比對規則：
 * - 移除頭尾空白
 * - 轉為小寫（處理英文歌名大小寫差異）
 * - 移除全形/半形空白差異（歌名中間的空白視為可忽略）
 */
function normalizeAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '');
}

export function isAnswerCorrect(userAnswer: string, correctTitle: string): boolean {
  if (!userAnswer) return false;
  return normalizeAnswer(userAnswer) === normalizeAnswer(correctTitle);
}
