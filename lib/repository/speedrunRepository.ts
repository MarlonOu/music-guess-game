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
  /** 回報目前這一題的音樂真的開始播放了，用來扣除網路不好造成的等待時間；盡量回報，
   *  失敗也不影響主流程，所以不回傳判定結果、呼叫端不需要處理錯誤 */
  reportAudioStarted(token: string, questionIndex: number): void;
  submit(token: string, displayName: string): Promise<RepositoryResult<SpeedrunSubmitResponse>>;
  getLeaderboard(): Promise<RepositoryResult<SpeedrunLeaderboardEntry[]>>;
}

export const speedrunRepository: SpeedrunRepository = {
  async start() {
    // 每個會回傳結果給呼叫端的方法，都要用 try/catch 包住整個流程，不能只處理
    // 「伺服器有回應、但回應內容是錯誤」這種情況——這是修正一個實際發生過的 bug：
    // fetch() 本身在網路真的斷線、逾時、連請求都送不出去時會直接丟出例外（不是回傳一個
    // status 不是 2xx 的 Response），沒有 catch 接住的話，這個例外會一路往上傳，
    // 呼叫端（app/speedrun/page.tsx 的 handleStart）原本也沒有對應的 catch，導致後續
    // 「失敗了要切回開頭畫面」的程式碼整段被跳過，畫面就卡死在「題目準備中」，沒有任何
    // 辦法恢復。這裡統一補上 catch，把任何網路層級的例外也轉換成正常的
    // { ok: false, error: ... } 回傳值，讓呼叫端不用特別區分「伺服器說失敗」跟
    // 「請求根本送不出去」，都走同一套錯誤處理流程。
    try {
      const res = await fetch('/api/speedrun/start', { method: 'POST' });
      if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '開始挑戰失敗') };
      const data = await res.json();
      return { ok: true, data: data as SpeedrunStartResponse };
    } catch {
      return { ok: false, error: '網路連線失敗，請檢查網路後再試一次' };
    }
  },

  async check(token, questionIndex, songId) {
    try {
      const res = await fetch('/api/speedrun/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, questionIndex, songId }),
      });
      if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '判定失敗') };
      const data = await res.json();
      return { ok: true, data: data as SpeedrunCheckResponse };
    } catch {
      return { ok: false, error: '網路連線失敗，請檢查網路後再試一次' };
    }
  },

  reportAudioStarted(token, questionIndex) {
    // 特意不 await、不處理失敗——這只是盡量而為的回報，失敗頂多就是這一題的網路等待時間
    // 沒被扣除，不影響答題本身，不值得為此讓呼叫端多寫一套錯誤處理。
    fetch('/api/speedrun/audio-started', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, questionIndex }),
    }).catch(() => {
      // 同上，靜默忽略
    });
  },

  async submit(token, displayName) {
    try {
      const res = await fetch('/api/speedrun/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, displayName }),
      });
      if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '送出成績失敗') };
      const data = await res.json();
      return { ok: true, data: data as SpeedrunSubmitResponse };
    } catch {
      return { ok: false, error: '網路連線失敗，請檢查網路後再試一次' };
    }
  },

  async getLeaderboard() {
    try {
      const res = await fetch('/api/speedrun/leaderboard');
      if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '查詢排行榜失敗') };
      const data = await res.json();
      return { ok: true, data: data.leaderboard as SpeedrunLeaderboardEntry[] };
    } catch {
      return { ok: false, error: '網路連線失敗，請檢查網路後再試一次' };
    }
  },
};
