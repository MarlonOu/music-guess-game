export interface Song {
  id: string;
  title: string;
  artistId: string;
  audioUrl: string;
  durationSec: number;
  introEndSec: number;
  lyrics: string;
  createdAt: string;
}

export interface SongFilter {
  artistIds?: string[];
  themeIds?: string[];
}
