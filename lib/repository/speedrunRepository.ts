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

// fetch() 本身沒有任何內建逾時機制——瀏覽器不會自動放棄一個「送出去但一直沒有回應」的
// 請求，如果手機網路訊號不穩、連線本身卡住（不是乾淨的斷線，是那種封包有去無回、
// TCP 連線沒有正常關閉的狀態），這個 fetch() 的 Promise 可能真的會掛在那裡幾分鐘甚至更久，
// 既不 resolve 也不 reject，前面補的 try/catch 對這種情況完全沒有幫助（catch 只能接住
// 「拋出例外」，接不住「永遠不 settle」）。這是實際發生過的問題：手機上偶爾會卡在
// 「題目準備中」很久，用者反映只要切去別的 App 再切回來就會恢復——這正好是手機作業系統
// 通常會拿來重置／放棄卡住連線的時機點，說明問題很可能就出在這種「連線卡住不動」，
// 不一定跟 YouTube 有關（YouTube 那條路徑已經另外處理過逾時，這裡要保護的是「打自己
// 伺服器的這幾支 API」本身）。
// 用 AbortController 幫每一次 fetch() 都加上明確的逾時，逾時就主動放棄這次請求，
// 讓呼叫端確實拿到一個失敗結果可以處理，而不是無限期卡住等一個永遠不會來的回應。
const FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export interface SpeedrunRepository {
  start(): Promise<RepositoryResult<SpeedrunStartResponse>>;
  check(token: string, questionIndex: number, songId: string): Promise<RepositoryResult<SpeedrunCheckResponse>>;
  /** 回報目前這一題自己量測到的等待毫秒數，用來扣除網路不好造成的等待時間；盡量回報，
   *  失敗也不影響主流程，所以不回傳判定結果、呼叫端不需要處理錯誤 */
  reportAudioStarted(token: string, questionIndex: number, waitMs: number): void;
  submit(token: string, displayName: string): Promise<RepositoryResult<SpeedrunSubmitResponse>>;
  getLeaderboard(): Promise<RepositoryResult<SpeedrunLeaderboardEntry[]>>;
}

export const speedrunRepository: SpeedrunRepository = {
  async start() {
    // 每個會回傳結果給呼叫端的方法，都要用 try/catch 包住整個流程，不能只處理
    // 「伺服器有回應、但回應內容是錯誤」這種情況——fetch() 本身在網路真的斷線、逾時、
    // 連請求都送不出去時會直接丟出例外（不是回傳一個 status 不是 2xx 的 Response），
    // 沒有 catch 接住的話，這個例外會一路往上傳，呼叫端（app/speedrun/page.tsx 的
    // handleStart）原本也沒有對應的 catch，導致後續「失敗了要切回開頭畫面」的程式碼整段
    // 被跳過，畫面就卡死在「題目準備中」。這裡統一補上 catch，把任何網路層級的例外
    // （包含上面 fetchWithTimeout 主動逾時放棄造成的 AbortError）都轉換成正常的
    // { ok: false, error: ... } 回傳值，讓呼叫端不用特別區分「伺服器說失敗」跟
    // 「請求根本送不出去／卡住太久」，都走同一套錯誤處理流程。
    try {
      const res = await fetchWithTimeout('/api/speedrun/start', { method: 'POST' });
      if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '開始挑戰失敗') };
      const data = await res.json();
      return { ok: true, data: data as SpeedrunStartResponse };
    } catch {
      return { ok: false, error: '網路連線失敗，請檢查網路後再試一次' };
    }
  },

  async check(token, questionIndex, songId) {
    try {
      const res = await fetchWithTimeout('/api/speedrun/check', {
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

  reportAudioStarted(token, questionIndex, waitMs) {
    // 特意不 await、不處理失敗——這只是盡量而為的回報，失敗頂多就是這一題的網路等待時間
    // 沒被扣除，不影響答題本身，不值得為此讓呼叫端多寫一套錯誤處理。仍然套用逾時，
    // 避免留下一個永遠掛著的請求佔用連線資源。
    fetchWithTimeout('/api/speedrun/audio-started', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, questionIndex, waitMs }),
    }).catch(() => {
      // 同上，靜默忽略
    });
  },

  async submit(token, displayName) {
    try {
      const res = await fetchWithTimeout('/api/speedrun/submit', {
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
      const res = await fetchWithTimeout('/api/speedrun/leaderboard');
      if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '查詢排行榜失敗') };
      const data = await res.json();
      return { ok: true, data: data.leaderboard as SpeedrunLeaderboardEntry[] };
    } catch {
      return { ok: false, error: '網路連線失敗，請檢查網路後再試一次' };
    }
  },
};
