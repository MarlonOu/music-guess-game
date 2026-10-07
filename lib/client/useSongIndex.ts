'use client';

import { useEffect, useState } from 'react';

export interface SongIndexItem {
  id: string;
  title: string;
  artist: string;
}

let cache: SongIndexItem[] | null = null;
let inflight: Promise<SongIndexItem[]> | null = null;

function loadIndex(): Promise<SongIndexItem[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= fetch('/api/songs/index')
    .then((r) => (r.ok ? r.json() : { songs: [] }))
    .then((d: { songs: SongIndexItem[] }) => {
      cache = d.songs ?? [];
      return cache;
    })
    .catch(() => {
      inflight = null;
      return [] as SongIndexItem[];
    });
  return inflight;
}

/** 載入搜尋輸入用的歌名／歌手精簡索引（整個頁面生命週期只抓一次）。enabled 為 false 時不發請求。 */
export function useSongIndex(enabled = true): SongIndexItem[] {
  const [songs, setSongs] = useState<SongIndexItem[]>(cache ?? []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadIndex().then((s) => {
      if (!cancelled) setSongs(s);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return songs;
}
