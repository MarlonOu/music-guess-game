'use client';

import { useRef, useState } from 'react';
import { buttonStyle, editButtonStyle, formatDuration, inputStyle } from './adminShared';

export type MatchPlatform = 'apple' | 'deezer';

export interface SourceCandidateView {
  trackId: string;
  trackName: string;
  artistName: string;
  previewUrl: string;
  durationSec: number;
}

export const PLATFORM_LABEL: Record<MatchPlatform, string> = { apple: 'Apple Music', deezer: 'Deezer' };

/** 單列的手動來源搜尋：用歌名＋歌手（可改關鍵字）搜尋平台，試聽後點「關連這個來源」指定給該列 */
export function ManualSourceSearch({
  platform,
  defaultQuery,
  country,
  targetDurationSec,
  rowLabel,
  onPick,
  onClose,
}: {
  platform: MatchPlatform;
  defaultQuery: string;
  country: string;
  targetDurationSec: number;
  rowLabel: string;
  onPick: (candidate: SourceCandidateView) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<SourceCandidateView[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const requestId = useRef(0);

  async function search() {
    const q = query.trim();
    if (!q || searching) return;
    const id = ++requestId.current;
    setSearching(true);
    setError(null);
    setPlaying(null);
    try {
      const url =
        platform === 'apple'
          ? `/api/apple-music-search?q=${encodeURIComponent(q)}&country=${encodeURIComponent(country)}`
          : `/api/deezer-search?q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (id !== requestId.current) return;
      if (!res.ok) {
        setError(data.error ?? `搜尋失敗（HTTP ${res.status}）`);
        setResults(null);
      } else {
        setResults(Array.isArray(data.results) ? data.results : []);
      }
    } catch {
      if (id === requestId.current) {
        setError('網路錯誤，請稍後再試');
        setResults(null);
      }
    } finally {
      if (id === requestId.current) setSearching(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={`手動搜尋 ${PLATFORM_LABEL[platform]} 來源：${rowLabel}`}
      style={{ marginLeft: '21px', padding: '10px', borderRadius: '8px', border: '1px solid var(--groove)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`${PLATFORM_LABEL[platform]} 搜尋關鍵字`}
          placeholder="歌名 歌手"
          style={{ ...inputStyle, flex: '1 1 200px', minHeight: '40px' }}
        />
        <button type="submit" disabled={searching || !query.trim()} style={{ ...buttonStyle, padding: '8px 14px', fontSize: '0.85rem', minHeight: '40px' }}>
          {searching ? '搜尋中…' : '搜尋'}
        </button>
        <button type="button" onClick={onClose} style={{ ...editButtonStyle, minHeight: '40px' }}>
          關閉
        </button>
      </form>
      <div role="status" aria-live="polite" style={{ fontSize: '0.78rem', color: error ? 'var(--error)' : 'var(--ink-dim)' }}>
        {error ?? (results ? (results.length === 0 ? '沒有搜尋結果，請換個關鍵字（例如只輸入歌名，或改用英文名稱）' : `找到 ${results.length} 筆，試聽確認後點「關連這個來源」`) : '')}
      </div>
      {results && results.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {results.map((r) => {
            const diff = targetDurationSec > 0 && r.durationSec > 0 ? Math.abs(r.durationSec - targetDurationSec) : null;
            const key = r.trackId;
            return (
              <li key={key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--groove)' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.82rem', flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
                    「{r.trackName}」－{r.artistName}
                    {r.durationSec > 0 && `・${formatDuration(r.durationSec)}`}
                    {diff !== null && (
                      <span style={{ color: diff > 15 ? 'var(--accent)' : 'var(--success)' }}>
                        {`（與題庫差 ${diff} 秒）`}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    style={{ ...editButtonStyle, minHeight: '36px' }}
                    aria-pressed={playing === key}
                    onClick={() => setPlaying((k) => (k === key ? null : key))}
                  >
                    {playing === key ? '收起試聽' : '試聽'}
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonStyle, padding: '6px 12px', fontSize: '0.8rem', minHeight: '36px' }}
                    onClick={() => onPick(r)}
                  >
                    關連這個來源
                  </button>
                </div>
                {playing === key && <audio controls autoPlay src={r.previewUrl} style={{ height: '32px', maxWidth: '100%' }} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
