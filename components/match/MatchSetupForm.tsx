'use client';

import { useEffect, useState } from 'react';
import type { PlayerProfile } from '../../lib/types/player';
import type { Artist, Theme } from '../../lib/types/theme';
import type { GameMode } from '../../lib/types/match';
import { songRepository } from '../../lib/repository/songRepository';
import { ArtistFilter } from '../filter/ArtistFilter';
import { ThemeFilter } from '../filter/ThemeFilter';
import { PlayerPicker } from '../player/PlayerPicker';

const MODES: { code: GameMode; label: string; path: string }[] = [
  { code: 'INTRO', label: '前奏猜歌', path: '/intro' },
  { code: 'RANDOM_CLIP', label: '隨機片段猜歌', path: '/random-clip' },
  { code: 'LYRIC_LINE', label: '歌詞猜歌', path: '/lyric-line' },
];

type FilterType = 'artist' | 'theme';

export function MatchSetupForm() {
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerProfile[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [selectedArtistIds, setSelectedArtistIds] = useState<string[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [selectedThemeIds, setSelectedThemeIds] = useState<string[]>([]);
  // 歌手篩選、主題篩選只能擇一使用，不能同時套用兩種條件
  const [filterType, setFilterType] = useState<FilterType>('artist');
  const [mode, setMode] = useState<GameMode>('INTRO');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    songRepository.getAllArtists().then(
      (data) => {
        if (!cancelled) setArtists(data);
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '讀取歌手清單失敗');
      }
    );
    songRepository.getAllThemes().then(
      (data) => {
        if (!cancelled) setThemes(data);
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '讀取主題清單失敗');
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleArtist(id: string) {
    setSelectedArtistIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleTheme(id: string) {
    setSelectedThemeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function switchFilterType(type: FilterType) {
    setFilterType(type);
    // 切換篩選種類時清空另一種的已選項目，避免兩種條件同時存在卻只有一種會實際生效造成誤解
    if (type === 'artist') setSelectedThemeIds([]);
    else setSelectedArtistIds([]);
  }

  const selectedPath = MODES.find((m) => m.code === mode)!.path;
  const query = new URLSearchParams();
  if (selectedPlayers.length > 0) query.set('players', selectedPlayers.map((p) => p.id).join(','));
  if (filterType === 'artist' && selectedArtistIds.length > 0) query.set('artists', selectedArtistIds.join(','));
  if (filterType === 'theme' && selectedThemeIds.length > 0) query.set('themes', selectedThemeIds.join(','));
  // 不帶 rounds 參數：GamePage 會把篩選出來的全部歌曲玩完，不再限制固定題數
  const startHref = `${selectedPath}?${query.toString()}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', maxWidth: '480px' }}>
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>模式</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {MODES.map((m) => (
            <button
              key={m.code}
              onClick={() => setMode(m.code)}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '10px',
                border: mode === m.code ? '1px solid var(--accent)' : '1px solid var(--groove)',
                background: mode === m.code ? 'var(--bg-raised)' : 'transparent',
                color: mode === m.code ? 'var(--accent)' : 'var(--ink)',
                fontSize: '0.9rem',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
          這次一起玩的人（不加 = 單機無人別模式）
        </span>
        <PlayerPicker selected={selectedPlayers} onChange={setSelectedPlayers} onError={setError} />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
          題庫篩選方式（歌手／主題擇一，不能同時套用）
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => switchFilterType('artist')}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '10px',
              border: filterType === 'artist' ? '1px solid var(--accent)' : '1px solid var(--groove)',
              background: filterType === 'artist' ? 'var(--bg-raised)' : 'transparent',
              color: filterType === 'artist' ? 'var(--accent)' : 'var(--ink)',
              fontSize: '0.9rem',
            }}
          >
            依歌手篩選
          </button>
          <button
            onClick={() => switchFilterType('theme')}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '10px',
              border: filterType === 'theme' ? '1px solid var(--accent)' : '1px solid var(--groove)',
              background: filterType === 'theme' ? 'var(--bg-raised)' : 'transparent',
              color: filterType === 'theme' ? 'var(--accent)' : 'var(--ink)',
              fontSize: '0.9rem',
            }}
          >
            依主題篩選
          </button>
        </div>

        {filterType === 'artist' ? (
          <ArtistFilter artists={artists} selectedIds={selectedArtistIds} onToggle={toggleArtist} />
        ) : (
          <ThemeFilter themes={themes} selectedIds={selectedThemeIds} onToggle={toggleTheme} />
        )}
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>不勾選任何項目 = 使用全部題庫</span>
      </section>

      <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
        本場會把符合篩選條件的歌曲全部玩完，題數不設上限。
      </p>

      <a
        href={startHref}
        style={{
          textAlign: 'center',
          padding: '14px',
          borderRadius: '12px',
          border: 'none',
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          fontWeight: 600,
          fontSize: '1.05rem',
        }}
      >
        開始比賽
      </a>
    </div>
  );
}
