import type {
  SpeedrunStartResponse,
  SpeedrunCheckResponse,
  SpeedrunSubmitResponse,
  SpeedrunLeaderboardEntry,
} from '../types/speedrun';

export interface RepositoryResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return typeof data.error === 'string' ? data.error : fallback;
  } catch {
    return fallback;
  }
}

export interface SpeedrunRepository {
  start(): Promise<RepositoryResult<SpeedrunStartResponse>>;
  check(token: string, questionIndex: number, songId: string): Promise<RepositoryResult<SpeedrunCheckResponse>>;
  submit(token: string, displayName: string): Promise<RepositoryResult<SpeedrunSubmitResponse>>;
  getLeaderboard(): Promise<RepositoryResult<SpeedrunLeaderboardEntry[]>>;
}

export const speedrunRepository: SpeedrunRepository = {
  async start() {
    const res = await fetch('/api/speedrun/start', { method: 'POST' });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '開始挑戰失敗') };
    const data = await res.json();
    return { ok: true, data: data as SpeedrunStartResponse };
  },

  async check(token, questionIndex, songId) {
    const res = await fetch('/api/speedrun/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, questionIndex, songId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '判定失敗') };
    const data = await res.json();
    return { ok: true, data: data as SpeedrunCheckResponse };
  },

  async submit(token, displayName) {
    const res = await fetch('/api/speedrun/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, displayName }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '送出成績失敗') };
    const data = await res.json();
    return { ok: true, data: data as SpeedrunSubmitResponse };
  },

  async getLeaderboard() {
    const res = await fetch('/api/speedrun/leaderboard');
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '查詢排行榜失敗') };
    const data = await res.json();
    return { ok: true, data: data.leaderboard as SpeedrunLeaderboardEntry[] };
  },
};
