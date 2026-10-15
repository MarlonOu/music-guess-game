import type { DuplicateReport, SubmissionCheckResponse } from '../types/submission';

export interface RepositoryResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** 伺服器拒絕時附帶的重複性檢查結果（409） */
  report?: DuplicateReport;
  needsAcknowledge?: boolean;
}

const NETWORK_ERROR = '網路連線失敗，請檢查網路後再試一次';

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<RepositoryResult<T>> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: typeof data.error === 'string' ? data.error : '操作失敗',
        report: data.report,
        needsAcknowledge: Boolean(data.needsAcknowledge),
      };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { ok: false, error: 'aborted' };
    return { ok: false, error: NETWORK_ERROR };
  }
}

export const submissionRepository = {
  check: (input: { url: string; title?: string; artist?: string }, signal?: AbortSignal) =>
    post<SubmissionCheckResponse>('/api/submissions/check', input, signal),
  submit: (input: {
    url: string;
    title: string;
    artist: string;
    note: string;
    submitterName: string;
    acknowledgeWarning: boolean;
  }) => post<{ id: string }>('/api/submissions', input),
};
