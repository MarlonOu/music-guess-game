import type { RoomState, RoomMessage, AnswerMode } from '../types/room';
import type { GameMode } from '../types/match';
import { recordServerTime } from '../client/serverClock';

export interface RepositoryResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * 玩家憑證：建立／加入房間時伺服器發給本人的隨機字串，之後代表這位玩家的操作都要附上
 * （伺服器端見 lib/server/playerAuth.ts）。依 playerId 存在 sessionStorage，跟頁面既有的
 * room-player-${joinCode} 一樣只存在這個分頁，重新整理頁面後仍然有效，頁面程式碼不需要知道它的存在。
 */
const tokenKey = (playerId: string) => `room-player-token-${playerId}`;

function saveToken(playerId: string, token: unknown): void {
  if (typeof token !== 'string' || !token) return;
  try {
    sessionStorage.setItem(tokenKey(playerId), token);
  } catch {
    // 無痕模式等情況 sessionStorage 可能不可用，此時僅在本次頁面生命週期內無法自動復原身分
  }
}

function readToken(playerId: string): string {
  try {
    return sessionStorage.getItem(tokenKey(playerId)) ?? '';
  } catch {
    return '';
  }
}

/** 代表某位玩家發出的請求共用的標頭 */
function playerHeaders(playerId: string): Record<string, string> {
  const token = readToken(playerId);
  return { 'Content-Type': 'application/json', ...(token ? { 'x-player-token': token } : {}) };
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

export interface RoomRepository {
  create(
    displayName: string,
    mode: GameMode,
    answerMode?: AnswerMode
  ): Promise<RepositoryResult<{ room: RoomState; playerId: string }>>;
  join(joinCode: string, displayName: string): Promise<RepositoryResult<{ room: RoomState; playerId: string }>>;
  getState(joinCode: string): Promise<RepositoryResult<RoomState>>;
  updateSettings(
    joinCode: string,
    playerId: string,
    input: { mode?: GameMode; answerMode?: AnswerMode; artistFilterIds?: string[]; themeFilterIds?: string[] }
  ): Promise<RepositoryResult<RoomState>>;
  start(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  next(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  /** 投票／收回投票「跳過這一題」；全房間玩家都投了就直接公布答案（不計分） */
  voteSkip(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  /** 選擇題搶答模式（answerMode='choice'）點選一個選項；回傳 correct 表示這次點選對不對 */
  answerChoice(joinCode: string, playerId: string, songId: string): Promise<RepositoryResult<{ correct: boolean; room: RoomState }>>;
  end(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  restart(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  sendMessage(joinCode: string, playerId: string, text: string): Promise<RepositoryResult<RoomMessage>>;
  getMessages(joinCode: string, after?: string): Promise<RepositoryResult<RoomMessage[]>>;
  leave(joinCode: string, playerId: string): Promise<RepositoryResult<{ roomDeleted: boolean }>>;
  /** 用 sendBeacon 送出離開請求，供使用者關閉分頁/切換頁面時盡量確保有送到（fetch 在頁面卸載當下不保證送達） */
  leaveBeacon(joinCode: string, playerId: string): void;
}

export const roomRepository: RoomRepository = {
  async create(displayName, mode, answerMode) {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, mode, answerMode }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '建立房間失敗') };
    const data = await res.json();
    saveToken(data.playerId, data.playerToken);
    return { ok: true, data: { room: data.room, playerId: data.playerId } };
  },

  async join(joinCode, displayName) {
    const res = await fetch(`/api/rooms/${joinCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '加入房間失敗') };
    const data = await res.json();
    saveToken(data.playerId, data.playerToken);
    return { ok: true, data: { room: data.room, playerId: data.playerId } };
  },

  async getState(joinCode) {
    const requestSentAtMs = Date.now();
    const res = await fetch(`/api/rooms/${joinCode}`);
    const responseReceivedAtMs = Date.now();
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '房間狀態查詢失敗') };
    const data = await res.json();
    // 每次輪詢順便校正一次裝置時鐘跟伺服器時鐘的偏移量（見 lib/client/serverClock.ts），
    // 這樣倒數／換題時機的計算才不會因為某台裝置系統時鐘不準而固定跑掉。
    if (typeof data.serverTime === 'string') {
      recordServerTime(data.serverTime, requestSentAtMs, responseReceivedAtMs);
    }
    return { ok: true, data: data.room as RoomState };
  },

  async updateSettings(joinCode, playerId, input) {
    const res = await fetch(`/api/rooms/${joinCode}/settings`, {
      method: 'PATCH',
      headers: playerHeaders(playerId),
      body: JSON.stringify({ playerId, ...input }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '更新設定失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async start(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/start`, {
      method: 'POST',
      headers: playerHeaders(playerId),
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '開始遊戲失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async next(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/next`, {
      method: 'POST',
      headers: playerHeaders(playerId),
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '推進題目失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async voteSkip(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/vote-skip`, {
      method: 'POST',
      headers: playerHeaders(playerId),
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '投票跳題失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async answerChoice(joinCode, playerId, songId) {
    const res = await fetch(`/api/rooms/${joinCode}/answer-choice`, {
      method: 'POST',
      headers: playerHeaders(playerId),
      body: JSON.stringify({ playerId, songId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '搶答失敗') };
    const data = await res.json();
    return { ok: true, data: { correct: Boolean(data.correct), room: data.room as RoomState } };
  },

  async end(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/end`, {
      method: 'POST',
      headers: playerHeaders(playerId),
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '結束比賽失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async restart(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/restart`, {
      method: 'POST',
      headers: playerHeaders(playerId),
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '重新開始失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async sendMessage(joinCode, playerId, text) {
    const res = await fetch(`/api/rooms/${joinCode}/messages`, {
      method: 'POST',
      headers: playerHeaders(playerId),
      body: JSON.stringify({ playerId, text }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '傳送訊息失敗') };
    const data = await res.json();
    return { ok: true, data: data.message as RoomMessage };
  },

  async getMessages(joinCode, after) {
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    const res = await fetch(`/api/rooms/${joinCode}/messages${query}`);
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '訊息查詢失敗') };
    const data = await res.json();
    return { ok: true, data: data.messages as RoomMessage[] };
  },

  async leave(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/leave`, {
      method: 'POST',
      headers: playerHeaders(playerId),
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '離開房間失敗') };
    const data = await res.json();
    return { ok: true, data: { roomDeleted: Boolean(data.roomDeleted) } };
  },

  leaveBeacon(joinCode, playerId) {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    // sendBeacon 無法自訂標頭，憑證改放在 body
    const blob = new Blob([JSON.stringify({ playerId, playerToken: readToken(playerId) })], { type: 'application/json' });
    navigator.sendBeacon(`/api/rooms/${joinCode}/leave`, blob);
  },
};
