'use client';

import { useEffect, useState } from 'react';
import type { PlayerProfile } from '../../lib/types/player';
import type { Artist } from '../../lib/types/theme';
import type { GameMode } from '../../lib/types/match';
import { playerRepository } from '../../lib/repository/playerRepository';
import { songRepository } from '../../lib/repository/songRepository';
import { DEFAULT_ROUND_COUNT } from '../../lib/engine/gameEngine';
import { ArtistFilter } from '../filter/ArtistFilter';

const MODES: { code: GameMode; label: string; path: string }[] = [
  { code: 'INTRO', label: '前奏猜歌', path: '/intro' },
  { code: 'RANDOM_CLIP', label: '隨機片段猜歌', path: '/random-clip' },
  { code: 'LYRIC_LINE', label: '歌詞猜歌', path: '/lyric-line' },
];

export function MatchSetupForm() {
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [selectedArtistIds, setSelectedArtistIds] = useState<string[]>([]);
  const [roundCount, setRoundCount] = useState(DEFAULT_ROUND_COUNT);
  const [mode, setMode] = useState<GameMode>('INTRO');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    playerRepository.getAll().then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) {
        setPlayers(result.data);
      } else {
        setError(result.error ?? '讀取對戰人別失敗');
      }
    });
    songRepository.getAllArtists().then(
      (data) => {
        if (!cancelled) setArtists(data);
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '讀取歌手清單失敗');
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function togglePlayer(id: string) {
    setSelectedPlayerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleArtist(id: string) {
    setSelectedArtistIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const selectedPath = MODES.find((m) => m.code === mode)!.path;
  const query = new URLSearchParams();
  if (selectedPlayerIds.length > 0) query.set('players', selectedPlayerIds.join(','));
  if (selectedArtistIds.length > 0) query.set('artists', selectedArtistIds.join(','));
  query.set('rounds', String(roundCount));
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
          參與人別（不勾選 = 單機無人別模式）
        </span>
        {players.length === 0 && (
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
            尚無對戰人別，可於「對戰人別管理」新增，或直接以單機模式開始
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {players.map((p) => (
            <label
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid var(--groove)',
                background: selectedPlayerIds.includes(p.id) ? 'var(--bg-raised)' : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={selectedPlayerIds.includes(p.id)}
                onChange={() => togglePlayer(p.id)}
              />
              <span>{p.displayName}</span>
            </label>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
          歌手篩選（不勾選 = 全部歌手）
        </span>
        <ArtistFilter artists={artists} selectedIds={selectedArtistIds} onToggle={toggleArtist} />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>題數</span>
        <input
          type="number"
          min={1}
          max={20}
          value={roundCount}
          onChange={(e) => setRoundCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          style={{
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid var(--groove)',
            background: 'var(--bg-raised)',
            color: 'var(--ink)',
            width: '100px',
          }}
        />
      </section>

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
