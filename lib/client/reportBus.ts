import type { ReportCategory } from '../types/report';

export const OPEN_REPORT_EVENT = 'open-report-dialog';

export interface OpenReportDetail {
  category?: ReportCategory;
  /** 預填在說明欄的提示文字（使用者可修改） */
  prefill?: string;
}

/** 從任何頁面開啟回報視窗，並可預設分類 */
export function openReportDialog(detail: OpenReportDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OpenReportDetail>(OPEN_REPORT_EVENT, { detail }));
}
