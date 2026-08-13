import type { Song, SongFilter } from '../types/song';
import type { Artist, Theme } from '../types/theme';

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
  getAllThemes(): Promise<Theme[]>;
  // 以下為 /admin 資料庫管理頁面使用的管理方法
  createSong(input: Omit<Song, 'id' | 'createdAt'>): Promise<RepositoryResult<Song>>;
  updateSong(id: string, input: Partial<Omit<Song, 'id' | 'createdAt'>>): Promise<RepositoryResult<void>>;
  deleteSong(id: string): Promise<RepositoryResult<void>>;
  createArtist(input: Omit<Artist, 'id'>): Promise<RepositoryResult<Artist>>;
  updateArtist(id: string, input: Partial<Omit<Artist, 'id'>>): Promise<RepositoryResult<void>>;
  deleteArtist(id: string): Promise<RepositoryResult<void>>;
  createTheme(input: Omit<Theme, 'id'>): Promise<RepositoryResult<Theme>>;
  deleteTheme(id: string): Promise<RepositoryResult<void>>;
  importSongsCsv(csvText: string): Promise<RepositoryResult<ImportSummary>>;
}

export interface ImportRowResult {
  row: number;
  title: string;
  status: 'created' | 'updated' | 'error';
  error?: string;
}

export interface ImportSummary {
  summary: { created: number; updated: number; errors: number };
  results: ImportRowResult[];
}

async function fetchSongs(artistIds?: string[], themeIds?: string[]): Promise<Song[]> {
  const params = new URLSearchParams();
  if (artistIds && artistIds.length > 0) params.set('artistIds', artistIds.join(','));
  if (themeIds && themeIds.length > 0) params.set('themeIds', themeIds.join(','));
  const query = params.toString() ? `?${params.toString()}` : '';
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

// 階段二：呼叫內部 API（/api/songs、/api/artists、/api/themes），API 背後為 Postgres（見 prisma/schema.prisma）
// 查詢函式簽名與階段一（本機 JSON）完全相同，呼叫端（元件、遊戲邏輯層）不需修改
export const songRepository: SongRepository = {
  async getAll(): Promise<Song[]> {
    return fetchSongs();
  },

  async getByArtistIds(artistIds: string[]): Promise<Song[]> {
    return fetchSongs(artistIds);
  },

  async getFiltered(filter: SongFilter): Promise<Song[]> {
    // 歌手與主題篩選以交集方式套用（同時指定兩者時，兩個條件都要符合）
    return fetchSongs(filter.artistIds, filter.themeIds);
  },

  async getAllArtists(): Promise<Artist[]> {
    const res = await fetch('/api/artists');
    if (!res.ok) throw new Error(`歌手清單查詢失敗（HTTP ${res.status}）`);
    const data = await res.json();
    return data.artists as Artist[];
  },

  async getAllThemes(): Promise<Theme[]> {
    const res = await fetch('/api/themes');
    if (!res.ok) throw new Error(`主題清單查詢失敗（HTTP ${res.status}）`);
    const data = await res.json();
    return data.themes as Theme[];
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

  async createTheme(input) {
    const res = await fetch('/api/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '新增主題失敗') };
    const data = await res.json();
    return { ok: true, data: data.theme as Theme };
  },

  async deleteTheme(id) {
    const res = await fetch(`/api/themes/${id}`, { method: 'DELETE' });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '刪除主題失敗') };
    return { ok: true };
  },

  async importSongsCsv(csvText) {
    const res = await fetch('/api/songs/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      body: csvText,
    });
    if (!res.ok) return { ok: false, error: await parseErrorMessage(res, '匯入失敗') };
    const data = await res.json();
    return { ok: true, data: data as ImportSummary };
  },
};
