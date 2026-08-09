import type { Song, SongFilter } from '../types/song';
import type { Artist } from '../types/theme';

export interface RepositoryResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface SongRepository {
  getAll(): Promise<Song[]>;
  getByArtistIds(artistIds: string[]): Promise<Song[]>;
  getFiltered(filter: SongFilter): Promise<Song[]>;
  getAllArtists(): Promise<Artist[]>;
  // 以下為 /admin 資料庫管理頁面使用的管理方法
  createSong(input: Omit<Song, 'id' | 'createdAt'>): Promise<RepositoryResult<Song>>;
  updateSong(id: string, input: Partial<Omit<Song, 'id' | 'createdAt'>>): Promise<RepositoryResult<void>>;
  deleteSong(id: string): Promise<RepositoryResult<void>>;
  createArtist(input: Omit<Artist, 'id'>): Promise<RepositoryResult<Artist>>;
  updateArtist(id: string, input: Partial<Omit<Artist, 'id'>>): Promise<RepositoryResult<void>>;
  deleteArtist(id: string): Promise<RepositoryResult<void>>;
}

async function fetchSongs(artistIds?: string[]): Promise<Song[]> {
  const query = artistIds && artistIds.length > 0 ? `?artistIds=${artistIds.join(',')}` : '';
  const res = await fetch(`/api/songs${query}`);
  if (!res.ok) throw new Error(`題庫查詢失敗（HTTP ${res.status}）`);
  const data = await res.json();
  return data.songs as Song[];
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

// 階段二：呼叫內部 API（/api/songs、/api/artists），API 背後為 Postgres（見 prisma/schema.prisma）
// 查詢函式簽名與階段一（本機 JSON）完全相同，呼叫端（元件、遊戲邏輯層）不需修改
export const songRepository: SongRepository = {
  async getAll(): Promise<Song[]> {
    return fetchSongs();
  },

  async getByArtistIds(artistIds: string[]): Promise<Song[]> {
    return fetchSongs(artistIds);
  },

  async getFiltered(filter: SongFilter): Promise<Song[]> {
    // themeIds 篩選為保留功能，Phase 6 開放，目前僅套用 artistIds
    return fetchSongs(filter.artistIds);
  },

  async getAllArtists(): Promise<Artist[]> {
    const res = await fetch('/api/artists');
    if (!res.ok) throw new Error(`歌手清單查詢失敗（HTTP ${res.status}）`);
    const data = await res.json();
    return data.artists as Artist[];
  },

  async createSong(input) {
    const res = await fetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '新增歌曲失敗') };
    const data = await res.json();
    return { ok: true, data: data.song as Song };
  },

  async updateSong(id, input) {
    const res = await fetch(`/api/songs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '更新歌曲失敗') };
    return { ok: true };
  },

  async deleteSong(id) {
    const res = await fetch(`/api/songs/${id}`, { method: 'DELETE' });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '刪除歌曲失敗') };
    return { ok: true };
  },

  async createArtist(input) {
    const res = await fetch('/api/artists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '新增歌手失敗') };
    const data = await res.json();
    return { ok: true, data: data.artist as Artist };
  },

  async updateArtist(id, input) {
    const res = await fetch(`/api/artists/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '更新歌手失敗') };
    return { ok: true };
  },

  async deleteArtist(id) {
    const res = await fetch(`/api/artists/${id}`, { method: 'DELETE' });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '刪除歌手失敗') };
    return { ok: true };
  },
};
