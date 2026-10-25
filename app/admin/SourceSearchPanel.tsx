'use client';

import { useId, useRef, useState } from 'react';
import { buttonStyle, editButtonStyle, formatDuration, inputStyle } from './adminShared';
import { PLATFORM_LABEL, type MatchPlatform, type SourceCandidateView } from './ManualSourceSearch';

export type SearchPlatform = 'youtube' | MatchPlatform;

export interface YoutubeCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSec: number;
  embeddable: boolean;
}

export const SEARCH_PLATFORM_LABEL: Record<SearchPlatform, string> = { youtube: 'YouTube', ...PLATFORM_LABEL };
const SEARCH_PLATFORMS: SearchPlatform[] = ['youtube', 'apple', 'deezer'];

type ResultsByPlatform = {
  youtube: YoutubeCandidate[] | null;
  apple: SourceCandidateView[] | null;
  deezer: SourceCandidateView[] | null;
};

/**
 * 單列來源搜尋面板：搜尋框預先帶入「歌名 歌手」，以 radio button 切換搜尋 YouTube／Apple Music／Deezer，
 * 各平台的結果分開保留（切換回來不用重搜）。YouTube 搜尋每次約消耗 101 單位配額，因此不會自動搜尋，需按「搜尋」。
 */
export function SourceSearchPanel({
  defaultQuery,
  initialPlatform,
  country,
  rowLabel,
  targetDurationSec,
  onPickYoutube,
  onPickCandidate,
  onClose,
}: {
  defaultQuery: string;
  initialPlatform: SearchPlatform;
  country: string;
  rowLabel: string;
  /** 已知的歌曲長度（由已指定的其他來源推得），用於顯示結果與目標的差距；未知為 0 */
  targetDurationSec: number;
  onPickYoutube: (candidate: YoutubeCandidate) => void;
  onPickCandidate: (platform: MatchPlatform, candidate: SourceCandidateView) => void;
  onClose: () => void;
}) {
  const groupName = useId();
  const [platform, setPlatform] = useState<SearchPlatform>(initialPlatform);
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<ResultsByPlatform>({ youtube: null, apple: null, deezer: null });
  const [errors, setErrors] = useState<Partial<Record<SearchPlatform, string>>>({});
  const [searching, setSearching] = useState<SearchPlatform | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const requestId = useRef(0);

  async function search() {
    const q = query.trim();
    if (!q || searching) return;
    const target = platform;
    const id = ++requestId.current;
    setSearching(target);
    setErrors((e) => ({ ...e, [target]: undefined }));
    setPlayingKey(null);
    try {
      const url =
        target === 'youtube'
          ? `/api/youtube-search?q=${encodeURIComponent(q)}`
          : target === 'apple'
            ? `/api/apple-music-search?q=${encodeURIComponent(q)}&country=${encodeURIComponent(country)}`
            : `/api/deezer-search?q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (id !== requestId.current) return;
      if (!res.ok) {
        setErrors((e) => ({ ...e, [target]: data.error ?? `搜尋失敗（HTTP ${res.status}）` }));
        return;
      }
      setResults((r) => ({ ...r, [target]: Array.isArray(data.results) ? data.results : [] }));
    } catch {
      if (id === requestId.current) setErrors((e) => ({ ...e, [target]: '網路錯誤，請稍後再試' }));
    } finally {
      if (id === requestId.current) setSearching(null);
    }
  }

  const current = results[platform];
  const error = errors[platform];
  const status = error
    ? error
    : searching === platform
      ? '搜尋中…'
      : current
        ? current.length === 0
          ? '沒有搜尋結果，請換個關鍵字（例如只輸入歌名，或改用英文名稱）'
          : `找到 ${current.length} 筆，確認後點「關連這個來源」`
        : platform === 'youtube'
          ? '按「搜尋」開始（YouTube 每次搜尋約消耗 101 單位配額）'
          : '按「搜尋」開始';

  return (
    <div
      role="group"
      aria-label={`搜尋來源：${rowLabel}`}
      style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--groove)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <div role="radiogroup" aria-label="搜尋來源平台" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {SEARCH_PLATFORMS.map((p) => {
          const checked = platform === p;
          return (
            <label
              key={p}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                minHeight: '40px',
                padding: '0 12px',
                borderRadius: '999px',
                border: `1px solid ${checked ? 'var(--accent)' : 'var(--groove)'}`,
                color: checked ? 'var(--accent)' : 'var(--ink-dim)',
                background: checked ? 'var(--bg-raised)' : 'transparent',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name={groupName}
                value={p}
                checked={checked}
                onChange={() => {
                  setPlatform(p);
                  setPlayingKey(null);
                }}
                style={{ accentColor: 'var(--accent)' }}
              />
              {SEARCH_PLATFORM_LABEL[p]}
            </label>
          );
        })}
      </div>

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
          aria-label={`${SEARCH_PLATFORM_LABEL[platform]} 搜尋關鍵字`}
          placeholder="歌名 歌手"
          style={{ ...inputStyle, flex: '1 1 200px', minHeight: '40px' }}
        />
        <button type="submit" disabled={searching !== null || !query.trim()} style={{ ...buttonStyle, padding: '8px 14px', fontSize: '0.85rem', minHeight: '40px' }}>
          {searching === platform ? '搜尋中…' : '搜尋'}
        </button>
        <button type="button" onClick={onClose} style={{ ...editButtonStyle, minHeight: '40px' }}>
          關閉
        </button>
      </form>

      <div role="status" aria-live="polite" style={{ fontSize: '0.78rem', color: error ? 'var(--error)' : 'var(--ink-dim)' }}>
        {status}
      </div>

      {platform === 'youtube' && results.youtube && results.youtube.length > 0 && (
        <ul style={listStyle}>
          {results.youtube.map((r) => {
            const key = `yt:${r.videoId}`;
            const diff = targetDurationSec > 0 && r.durationSec > 0 ? Math.abs(r.durationSec - targetDurationSec) : null;
            return (
              <li key={key} style={itemStyle}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- 縮圖來自 YouTube 外部網域
                    <img src={r.thumbnailUrl} alt="" width={64} height={36} loading="lazy" style={{ borderRadius: '4px', flexShrink: 0, background: 'var(--groove)' }} />
                  )}
                  <span style={{ fontSize: '0.82rem', flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
                    {r.title}
                    <br />
                    <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem' }}>
                      {r.channelTitle}
                      {r.durationSec > 0 && `・${formatDuration(r.durationSec)}`}
                      {diff !== null && <span style={{ color: diff > 15 ? 'var(--accent)' : 'var(--success)' }}>{`（差 ${diff} 秒）`}</span>}
                    </span>
                    {!r.embeddable && (
                      <>
                        <br />
                        <span style={{ color: 'var(--error)', fontSize: '0.75rem' }}>擁有者關閉外部嵌入播放，遊戲內會無聲，無法使用</span>
                      </>
                    )}
                  </span>
                  <button type="button" style={{ ...editButtonStyle, minHeight: '36px' }} aria-pressed={playingKey === key} onClick={() => setPlayingKey((k) => (k === key ? null : key))}>
                    {playingKey === key ? '收起預覽' : '預覽'}
                  </button>
                  <button
                    type="button"
                    disabled={!r.embeddable}
                    style={{ ...buttonStyle, padding: '6px 12px', fontSize: '0.8rem', minHeight: '36px', opacity: r.embeddable ? 1 : 0.5 }}
                    onClick={() => onPickYoutube(r)}
                  >
                    關連這個來源
                  </button>
                </div>
                {playingKey === key && (
                  <div style={{ position: 'relative', width: '100%', maxWidth: '420px', aspectRatio: '16 / 9', borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
                    <iframe
                      title={`預覽：${r.title}`}
                      src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(r.videoId)}?rel=0`}
                      allow="encrypted-media; picture-in-picture"
                      allowFullScreen
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {platform !== 'youtube' && results[platform] && results[platform]!.length > 0 && (
        <ul style={listStyle}>
          {results[platform]!.map((r) => {
            const key = `${platform}:${r.trackId}`;
            const diff = targetDurationSec > 0 && r.durationSec > 0 ? Math.abs(r.durationSec - targetDurationSec) : null;
            return (
              <li key={key} style={itemStyle}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.82rem', flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
                    「{r.trackName}」－{r.artistName}
                    {r.durationSec > 0 && `・${formatDuration(r.durationSec)}`}
                    {diff !== null && <span style={{ color: diff > 15 ? 'var(--accent)' : 'var(--success)' }}>{`（差 ${diff} 秒）`}</span>}
                  </span>
                  <button type="button" style={{ ...editButtonStyle, minHeight: '36px' }} aria-pressed={playingKey === key} onClick={() => setPlayingKey((k) => (k === key ? null : key))}>
                    {playingKey === key ? '收起試聽' : '試聽'}
                  </button>
                  <button type="button" style={{ ...buttonStyle, padding: '6px 12px', fontSize: '0.8rem', minHeight: '36px' }} onClick={() => onPickCandidate(platform, r)}>
                    關連這個來源
                  </button>
                </div>
                {playingKey === key && <audio controls autoPlay src={r.previewUrl} style={{ height: '32px', maxWidth: '100%' }} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  maxHeight: '300px',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '6px 8px',
  borderRadius: '6px',
  border: '1px solid var(--groove)',
};
