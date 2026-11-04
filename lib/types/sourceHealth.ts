/** 來源健康檢查的共用型別（伺服器掃描結果與管理頁顯示共用） */

export type HealthPlatform = 'youtube' | 'apple' | 'deezer';
export type HealthSeverity = 'error' | 'warn';

/** 修復動作：refresh＝用 track id 取得最新試聽網址；remove＝移除這個來源 */
export type HealthFix = 'refresh' | 'remove';

export type HealthCode =
  // YouTube
  | 'yt-missing'
  | 'yt-rejected'
  | 'yt-not-embeddable'
  | 'yt-region-blocked'
  | 'yt-region-partial'
  | 'yt-age-restricted'
  | 'yt-live'
  // Apple Music
  | 'apple-missing'
  | 'apple-no-preview'
  | 'apple-no-stored-url'
  | 'apple-url-dead'
  | 'apple-url-changed'
  // Deezer
  | 'deezer-missing'
  | 'deezer-no-preview'
  | 'deezer-unreadable'
  | 'deezer-url-expired'
  | 'deezer-url-expiring'
  | 'deezer-url-dead'
  // 共用
  | 'check-failed';

export interface HealthFinding {
  songId: string;
  platform: HealthPlatform;
  severity: HealthSeverity;
  code: HealthCode;
  /** 給管理者看的說明 */
  message: string;
  /** 可一鍵套用的修復動作；沒有則為 null */
  fix: HealthFix | null;
  /** 補充資訊（例如影片標題、到期時間） */
  detail?: string;
}

export interface HealthScanResult {
  platform: HealthPlatform;
  /** 這批實際檢查的歌曲數（該平台有來源的歌曲） */
  checked: number;
  findings: HealthFinding[];
}

export const HEALTH_PLATFORM_LABEL: Record<HealthPlatform, string> = {
  youtube: 'YouTube',
  apple: 'Apple Music',
  deezer: 'Deezer',
};
