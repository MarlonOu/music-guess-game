export type ArtistGender = 'MALE' | 'FEMALE' | 'GROUP' | 'UNKNOWN';

export interface Artist {
  id: string;
  name: string;
  gender: ArtistGender;
}

// 保留，未來開發
export interface Theme {
  id: string;
  name: string;
  description: string;
}

// 保留，未來開發
export interface SongTheme {
  songId: string;
  themeId: string;
}
