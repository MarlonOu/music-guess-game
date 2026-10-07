export const DISPLAY_NAME_MAX_LENGTH = 20;

/**
 * 清理排行榜暱稱：移除控制字元與零寬字元、合併連續空白、截斷長度。
 * 清理後為空字串代表不合法。
 */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DISPLAY_NAME_MAX_LENGTH);
}
