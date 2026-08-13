import type { RoomState, RoomMessage } from '../types/room';
import type { GameMode } from '../types/match';

export interface RepositoryResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
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
  create(displayName: string, mode: GameMode): Promise<RepositoryResult<{ room: RoomState; playerId: string }>>;
  join(joinCode: string, displayName: string): Promise<RepositoryResult<{ room: RoomState; playerId: string }>>;
  getState(joinCode: string): Promise<RepositoryResult<RoomState>>;
  updateSettings(
    joinCode: string,
    playerId: string,
    input: { mode?: GameMode; artistFilterIds?: string[]; themeFilterIds?: string[] }
  ): Promise<RepositoryResult<RoomState>>;
  start(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  next(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  /** 投票／收回投票「跳過這一題」；全房間玩家都投了就直接公布答案（不計分） */
  voteSkip(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  end(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  restart(joinCode: string, playerId: string): Promise<RepositoryResult<RoomState>>;
  sendMessage(joinCode: string, playerId: string, text: string): Promise<RepositoryResult<RoomMessage>>;
  getMessages(joinCode: string, after?: string): Promise<RepositoryResult<RoomMessage[]>>;
  leave(joinCode: string, playerId: string): Promise<RepositoryResult<{ roomDeleted: boolean }>>;
  /** 用 sendBeacon 送出離開請求，供使用者關閉分頁/切換頁面時盡量確保有送到（fetch 在頁面卸載當下不保證送達） */
  leaveBeacon(joinCode: string, playerId: string): void;
}

export const roomRepository: RoomRepository = {
  async create(displayName, mode) {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, mode }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '建立房間失敗') };
    const data = await res.json();
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
    return { ok: true, data: { room: data.room, playerId: data.playerId } };
  },

  async getState(joinCode) {
    const res = await fetch(`/api/rooms/${joinCode}`);
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '房間狀態查詢失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async updateSettings(joinCode, playerId, input) {
    const res = await fetch(`/api/rooms/${joinCode}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, ...input }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '更新設定失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async start(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '開始遊戲失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async next(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '推進題目失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async voteSkip(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/vote-skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '投票跳題失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async end(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '結束比賽失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async restart(joinCode, playerId) {
    const res = await fetch(`/api/rooms/${joinCode}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '重新開始失敗') };
    const data = await res.json();
    return { ok: true, data: data.room as RoomState };
  },

  async sendMessage(joinCode, playerId, text) {
    const res = await fetch(`/api/rooms/${joinCode}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '離開房間失敗') };
    const data = await res.json();
    return { ok: true, data: { roomDeleted: Boolean(data.roomDeleted) } };
  },

  leaveBeacon(joinCode, playerId) {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    const blob = new Blob([JSON.stringify({ playerId })], { type: 'application/json' });
    navigator.sendBeacon(`/api/rooms/${joinCode}/leave`, blob);
  },
};
