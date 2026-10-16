export type ReportCategory = 'playback' | 'source' | 'answer' | 'ui' | 'other';
export type ReportStatus = 'open' | 'resolved' | 'ignored';

export const REPORT_CATEGORIES: { value: ReportCategory; label: string; hint: string }[] = [
  { value: 'playback', label: '播放問題', hint: '沒聲音、一直載入、播放中斷或卡住' },
  { value: 'source', label: '歌曲來源／版本錯誤', hint: '放出來的不是這首歌、版本不對、歌名或歌手有誤' },
  { value: 'answer', label: '答案判定／搜尋問題', hint: '答對卻被判錯、搜尋不到歌曲' },
  { value: 'ui', label: '畫面或操作異常', hint: '按鈕沒反應、版面跑掉、當機' },
  { value: 'other', label: '其他', hint: '建議或其他想告訴我們的事' },
];

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = Object.fromEntries(
  REPORT_CATEGORIES.map((c) => [c.value, c.label])
) as Record<ReportCategory, string>;

export type LogType = 'nav' | 'click' | 'net' | 'audio' | 'console' | 'error' | 'game' | 'env';
export type LogPrimitive = string | number | boolean | null;

/** 客戶端紀錄的一筆事件（t 為 epoch 毫秒；lvl：w 警告、e 錯誤，省略代表一般資訊） */
export interface ClientLogEntry {
  t: number;
  type: LogType;
  msg: string;
  lvl?: 'w' | 'e';
  data?: Record<string, LogPrimitive>;
}

export interface ErrorReportSummary {
  id: string;
  category: ReportCategory;
  message: string;
  nickname: string;
  contact: string;
  route: string;
  userAgent: string;
  env: Record<string, LogPrimitive>;
  logCount: number;
  errorCount: number;
  status: ReportStatus;
  adminNote: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ErrorReportDetail extends ErrorReportSummary {
  logs: ClientLogEntry[];
}
