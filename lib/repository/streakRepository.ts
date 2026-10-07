import type {
  StreakStartResponse,
  StreakGuessResponse,
  StreakNextResponse,
  StreakQuestion,
  StreakAnswer,
  StreakSubmitResponse,
  StreakLeaderboardEntry,
} from '../types/streak';

export interface RepositoryResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const FETCH_TIMEOUT_MS = 15000;
const NETWORK_ERROR = '網路連線失敗，請檢查網路後再試一次';

async function request<T>(path: string, body?: unknown, method: 'POST' | 'GET' = 'POST'): Promise<RepositoryResult<T>> {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      let message = '操作失敗';
      try {
        const data = await res.json();
        if (typeof data.error === 'string') message = data.error;
      } catch {
        // 回應不是 JSON 就沿用預設訊息
      }
      return { ok: false, error: message };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  } finally {
    clearTimeout(handle);
  }
}

export const streakRepository = {
  start: () => request<StreakStartResponse>('/api/streak/start'),
  guess: (token: string, input: { songId?: string; text?: string }) =>
    request<StreakGuessResponse>('/api/streak/guess', { token, ...input }),
  skipStage: async (token: string): Promise<RepositoryResult<StreakQuestion>> => {
    const r = await request<{ question: StreakQuestion }>('/api/streak/stage', { token });
    return r.ok && r.data ? { ok: true, data: r.data.question } : { ok: false, error: r.error };
  },
  giveUp: (token: string) =>
    request<{ answer: StreakAnswer; streak: number; score: number }>('/api/streak/giveup', { token }),
  next: (token: string) => request<StreakNextResponse>('/api/streak/next', { token }),
  end: (token: string) => request<{ streak: number; score: number }>('/api/streak/end', { token }),
  submit: (token: string, displayName: string) =>
    request<StreakSubmitResponse>('/api/streak/submit', { token, displayName }),
  getLeaderboard: async (): Promise<RepositoryResult<StreakLeaderboardEntry[]>> => {
    const r = await request<{ leaderboard: StreakLeaderboardEntry[] }>('/api/streak/leaderboard', undefined, 'GET');
    return r.ok && r.data ? { ok: true, data: r.data.leaderboard } : { ok: false, error: r.error };
  },
};
