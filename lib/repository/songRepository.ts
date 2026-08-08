import type { Song, SongFilter } from '../types/song';
import type { Artist } from '../types/theme';
import songsData from '../../data/songs.json';

export interface SongRepository {
  getAll(): Promise<Song[]>;
  getByArtistIds(artistIds: string[]): Promise<Song[]>;
  getFiltered(filter: SongFilter): Promise<Song[]>;
  getAllArtists(): Promise<Artist[]>;
}

// 階段一：本機實作，資料來源為 /data/songs.json
// 階段二切換為 API 版本時，僅需替換本檔案，函式簽名維持不變
export const songRepository: SongRepository = {
  async getAll(): Promise<Song[]> {
    return songsData.songs as Song[];
  },

  async getByArtistIds(artistIds: string[]): Promise<Song[]> {
    if (artistIds.length === 0) return songsData.songs as Song[];
    return (songsData.songs as Song[]).filter((s) => artistIds.includes(s.artistId));
  },

  async getFiltered(filter: SongFilter): Promise<Song[]> {
    let result = songsData.songs as Song[];
    if (filter.artistIds && filter.artistIds.length > 0) {
      result = result.filter((s) => filter.artistIds!.includes(s.artistId));
    }
    // themeIds 篩選為保留功能，Phase 6 開放
    return result;
  },

  async getAllArtists(): Promise<Artist[]> {
    return songsData.artists as Artist[];
  },
};
