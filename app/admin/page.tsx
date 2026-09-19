'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import Link from 'next/link';
import type { Song } from '../../lib/types/song';
import type { Artist, ArtistGender, Theme } from '../../lib/types/theme';
import { songRepository, type ImportSummary } from '../../lib/repository/songRepository';
import { SONG_CSV_COLUMNS } from '../../lib/csv/songCsv';

const GENDER_OPTIONS: { value: ArtistGender; label: string }[] = [
  { value: 'MALE', label: '男歌手' },
  { value: 'FEMALE', label: '女歌手' },
  { value: 'GROUP', label: '團體' },
  { value: 'UNKNOWN', label: '未分類' },
];

export default function AdminPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [artistList, themeList, songList] = await Promise.all([
        songRepository.getAllArtists(),
        songRepository.getAllThemes(),
        songRepository.getAll(),
      ]);
      setArtists(artistList);
      setThemes(themeList);
      setSongs(songList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '讀取資料失敗');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([songRepository.getAllArtists(), songRepository.getAllThemes(), songRepository.getAll()]).then(
      ([artistList, themeList, songList]) => {
        if (cancelled) return;
        setArtists(artistList);
        setThemes(themeList);
        setSongs(songList);
        setError(null);
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '讀取資料失敗');
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function flashNotice(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px',
        gap: '32px',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          ADMIN
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>資料庫管理</h1>
      </header>

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
      {notice && <p style={{ color: 'var(--success)' }}>{notice}</p>}

      <SongSection
        songs={songs}
        artists={artists}
        themes={themes}
        onChanged={reload}
        onError={setError}
        onNotice={flashNotice}
      />
      <ArtistSection artists={artists} onChanged={reload} onError={setError} onNotice={flashNotice} />
      <ThemeSection themes={themes} onChanged={reload} onError={setError} onNotice={flashNotice} />

      <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
        返回首頁
      </Link>
    </main>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  width: '100%',
  maxWidth: '720px',
  padding: '20px',
  borderRadius: '14px',
  border: '1px solid var(--groove)',
  background: 'var(--bg-raised)',
};

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '8px',
  border: '1px solid var(--groove)',
  background: 'var(--bg)',
  color: 'var(--ink)',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '8px',
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  fontWeight: 600,
};

const dangerButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid var(--groove)',
  background: 'transparent',
  color: 'var(--error)',
  fontSize: '0.85rem',
};

const editButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid var(--groove)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: '0.85rem',
};

interface SectionCallbacks {
  onChanged: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}

function ArtistSection({
  artists,
  onChanged,
  onError,
  onNotice,
}: { artists: Artist[] } & SectionCallbacks) {
  const [editing, setEditing] = useState<Artist | null>(null);

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: '1.1rem' }}>歌手管理（{artists.length}）</h2>

      <ArtistForm
        key={editing?.id ?? 'new'}
        editing={editing}
        onCancel={() => setEditing(null)}
        onSaved={(msg) => {
          onNotice(msg);
          setEditing(null);
          onChanged();
        }}
      />

      <ul
        style={{
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '360px',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        }}
      >
        {artists.map((a) => (
          <li
            key={a.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid var(--groove)',
            }}
          >
            <span>
              {a.name}
              <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', marginLeft: '8px' }}>
                {GENDER_OPTIONS.find((g) => g.value === a.gender)?.label ?? a.gender}
              </span>
            </span>
            <span style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setEditing(a)} style={editButtonStyle}>
                編輯
              </button>
              <button
                onClick={async () => {
                  const result = await songRepository.deleteArtist(a.id);
                  if (!result.ok) {
                    onError(result.error ?? '刪除歌手失敗');
                    return;
                  }
                  onNotice('已刪除歌手');
                  if (editing?.id === a.id) setEditing(null);
                  onChanged();
                }}
                style={dangerButtonStyle}
              >
                刪除
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArtistForm({
  editing,
  onCancel,
  onSaved,
}: {
  editing: Artist | null;
  onCancel: () => void;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [gender, setGender] = useState<ArtistGender>(editing?.gender ?? 'UNKNOWN');
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFormError('請輸入歌手／團體名稱');
      return;
    }

    const result = editing
      ? await songRepository.updateArtist(editing.id, { name: trimmed, gender })
      : await songRepository.createArtist({ name: trimmed, gender });

    if (!result.ok) {
      setFormError(result.error ?? '儲存歌手失敗');
      return;
    }
    onSaved(editing ? '已更新歌手' : '已新增歌手');
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="歌手／團體名稱"
        style={{ ...inputStyle, flex: 1, minWidth: '160px' }}
      />
      <select value={gender} onChange={(e) => setGender(e.target.value as ArtistGender)} style={inputStyle}>
        {GENDER_OPTIONS.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </select>
      <button type="submit" style={buttonStyle}>
        {editing ? '儲存' : '新增'}
      </button>
      {editing && (
        <button type="button" onClick={onCancel} style={editButtonStyle}>
          取消
        </button>
      )}
      {formError && <span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{formError}</span>}
    </form>
  );
}

interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSec: number;
  embeddable: boolean;
}

function ThemeSection({
  themes,
  onChanged,
  onError,
  onNotice,
}: { themes: Theme[] } & SectionCallbacks) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFormError('請輸入主題名稱');
      return;
    }
    const result = await songRepository.createTheme({ name: trimmed, description: description.trim() });
    if (!result.ok) {
      setFormError(result.error ?? '新增主題失敗');
      return;
    }
    onNotice('已新增主題');
    setName('');
    setDescription('');
    onChanged();
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: '1.1rem' }}>主題管理（{themes.length}）</h2>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
        例如「90年代金曲」「男歌手」「聽團歌」，在歌曲管理下方可為每首歌指派多個主題，比賽建立流程可依主題篩選題庫。
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="主題名稱"
          style={{ ...inputStyle, flex: 1, minWidth: '140px' }}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="說明（選填）"
          style={{ ...inputStyle, flex: 1, minWidth: '140px' }}
        />
        <button type="submit" style={buttonStyle}>
          新增
        </button>
        {formError && <span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{formError}</span>}
      </form>

      <ul
        style={{
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '280px',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        }}
      >
        {themes.map((t) => (
          <li
            key={t.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid var(--groove)',
            }}
          >
            <span>
              {t.name}
              {t.description && (
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', marginLeft: '8px' }}>
                  {t.description}
                </span>
              )}
            </span>
            <button
              onClick={async () => {
                const result = await songRepository.deleteTheme(t.id);
                if (!result.ok) {
                  onError(result.error ?? '刪除主題失敗');
                  return;
                }
                onNotice('已刪除主題');
                onChanged();
              }}
              style={dangerButtonStyle}
            >
              刪除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDuration(sec: number): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface YouTubePrefill {
  videoId: string;
  durationSec: number;
}

/**
 * 獨立於新增歌曲表單的搜尋區塊，收合在歌曲管理區塊最上方。
 * 搜尋與「填哪首歌」完全解耦：選定結果後透過 onPick 把資料往下傳給表單，
 * 不會像先前綁死在表單內部那樣，換歌手/換編輯目標時搜尋狀態互相干擾。
 */
function YouTubeSearchAccordion({ onPick }: { onPick: (result: YouTubePrefill) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedVideoId, setPickedVideoId] = useState<string | null>(null);
  // 目前正在試聽（在結果列內展開播放器）的影片，一次只展開一個避免畫面雜亂
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);

  async function runSearch(pageToken?: string) {
    if (query.trim().length === 0) return;
    if (pageToken) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const url = `/api/youtube-search?q=${encodeURIComponent(query.trim())}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'YouTube 搜尋失敗');
        if (!pageToken) setResults([]);
        return;
      }
      setResults((prev) => {
        const merged = pageToken ? [...prev, ...data.results] : data.results;
        // 分頁載入更多時，YouTube API 偶爾會在不同頁之間回傳重複的影片，
        // 依 videoId 去重，避免同一支影片在清單裡出現兩次（React key 重複、UI 也會誤導）
        const seen = new Set<string>();
        return merged.filter((r: YouTubeSearchResult) => {
          if (seen.has(r.videoId)) return false;
          seen.add(r.videoId);
          return true;
        });
      });
      setNextPageToken(data.nextPageToken ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'YouTube 搜尋失敗');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  function handleSearch() {
    setPreviewVideoId(null);
    runSearch();
  }

  return (
    <div style={{ border: '1px solid var(--groove)', borderRadius: '10px', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '12px 16px',
          background: 'var(--bg)',
          border: 'none',
          color: 'var(--ink)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: '0.95rem',
        }}
      >
        <span>從 YouTube 搜尋歌曲</span>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>{open ? '收合 ▲' : '展開 ▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--groove)' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="搜尋關鍵字，例如「晴天 周杰倫」"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" onClick={handleSearch} disabled={loading} style={editButtonStyle}>
              {loading ? '搜尋中…' : '搜尋'}
            </button>
          </div>
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}
          {results.length > 0 && (
            <>
              {/* overscrollBehavior: 'contain' 讓滑鼠滾輪滾到清單頂/底時停在清單邊界，
                  不會把捲動事件「冒泡」給外層頁面繼續捲動整頁 */}
              <ul
                style={{
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '420px',
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                }}
              >
                {results.map((r, i) => (
                  <li
                    key={r.videoId ? `${r.videoId}-${i}` : `no-id-${i}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      padding: '6px',
                      borderRadius: '8px',
                      border: pickedVideoId === r.videoId ? '1px solid var(--accent)' : '1px solid var(--groove)',
                      background: pickedVideoId === r.videoId ? 'var(--bg-raised)' : 'transparent',
                      opacity: r.embeddable ? 1 : 0.6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {r.thumbnailUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- 外部 YouTube 縮圖，非本地靜態資源，不適用 next/image 最佳化
                        <img src={r.thumbnailUrl} alt="" width={60} height={45} style={{ borderRadius: '4px', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title}
                        </p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--ink-dim)' }}>
                          {r.channelTitle}
                          {r.durationSec > 0 && ` · ${formatDuration(r.durationSec)}`}
                        </p>
                        {!r.embeddable && (
                          <p style={{ fontSize: '0.75rem', color: 'var(--error)' }}>
                            ⚠ 擁有者已關閉外部嵌入播放，選這支遊戲內會放不出聲音
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setPreviewVideoId((cur) => (cur === r.videoId ? null : r.videoId))}
                        style={{ ...editButtonStyle, flexShrink: 0 }}
                      >
                        {previewVideoId === r.videoId ? '收起試聽' : '試聽'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!r.embeddable) {
                            const proceed = window.confirm(
                              '這支影片已被擁有者關閉外部嵌入播放，加入後遊戲內會放不出聲音，仍要使用嗎？'
                            );
                            if (!proceed) return;
                          }
                          setPickedVideoId(r.videoId);
                          onPick({ videoId: r.videoId, durationSec: r.durationSec });
                        }}
                        style={{ ...editButtonStyle, flexShrink: 0 }}
                      >
                        使用
                      </button>
                    </div>
                    {previewVideoId === r.videoId && (
                      <iframe
                        width="100%"
                        height="220"
                        src={`https://www.youtube.com/embed/${r.videoId}?autoplay=1`}
                        title={r.title}
                        style={{ border: 'none', borderRadius: '8px' }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                      />
                    )}
                  </li>
                ))}
              </ul>
              {nextPageToken && (
                <button
                  type="button"
                  onClick={() => runSearch(nextPageToken)}
                  disabled={loadingMore}
                  style={{ ...editButtonStyle, alignSelf: 'center' }}
                >
                  {loadingMore ? '載入中…' : '載入更多結果'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface AppleMusicSearchResult {
  trackId: string;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  durationSec: number;
  previewUrl: string;
}

interface AppleMusicPrefill {
  trackId: string;
  previewUrl: string;
  durationSec: number;
}

/**
 * 跟 YouTubeSearchAccordion 同樣的獨立搜尋區塊設計：搜尋跟「填哪首歌」解耦，選定結果後
 * 透過 onPick 把資料往下傳給表單。這是優先來源（見 resolvePlaybackTarget.ts 的說明），
 * 建議每首歌都盡量補上這個來源，才能解決控制中心洩漏歌名答案的問題。
 */
function AppleMusicSearchAccordion({ onPick }: { onPick: (result: AppleMusicPrefill) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AppleMusicSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedTrackId, setPickedTrackId] = useState<string | null>(null);
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);

  async function handleSearch() {
    if (query.trim().length === 0) return;
    setPreviewTrackId(null);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apple-music-search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Apple Music 搜尋失敗');
        setResults([]);
        return;
      }
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apple Music 搜尋失敗');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--groove)', borderRadius: '10px', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '12px 16px',
          background: 'var(--bg)',
          border: 'none',
          color: 'var(--ink)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: '0.95rem',
        }}
      >
        <span>從 Apple Music 搜尋試聽來源（建議優先使用）</span>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>{open ? '收合 ▲' : '展開 ▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--groove)' }}>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
            Apple Music 官方試聽片段用同源 &lt;audio&gt; 播放，不會有控制中心洩漏歌名的問題（YouTube 是跨網域第三方播放器，這點沒辦法完全避免）。
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="搜尋關鍵字，例如「晴天 周杰倫」"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" onClick={handleSearch} disabled={loading} style={editButtonStyle}>
              {loading ? '搜尋中…' : '搜尋'}
            </button>
          </div>
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}
          {results.length > 0 && (
            <ul
              style={{
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxHeight: '420px',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
              }}
            >
              {results.map((r) => (
                <li
                  key={r.trackId}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    padding: '6px',
                    borderRadius: '8px',
                    border: pickedTrackId === r.trackId ? '1px solid var(--accent)' : '1px solid var(--groove)',
                    background: pickedTrackId === r.trackId ? 'var(--bg-raised)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {r.artworkUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- 外部 Apple 封面圖，非本地靜態資源，不適用 next/image 最佳化
                      <img src={r.artworkUrl} alt="" width={45} height={45} style={{ borderRadius: '4px', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.trackName}
                      </p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--ink-dim)' }}>
                        {r.artistName}
                        {r.durationSec > 0 && ` · ${formatDuration(r.durationSec)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewTrackId((cur) => (cur === r.trackId ? null : r.trackId))}
                      style={{ ...editButtonStyle, flexShrink: 0 }}
                    >
                      {previewTrackId === r.trackId ? '收起試聽' : '試聽'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPickedTrackId(r.trackId);
                        onPick({ trackId: r.trackId, previewUrl: r.previewUrl, durationSec: r.durationSec });
                      }}
                      style={{ ...editButtonStyle, flexShrink: 0 }}
                    >
                      使用
                    </button>
                  </div>
                  {previewTrackId === r.trackId && (
                    <audio controls autoPlay src={r.previewUrl} style={{ width: '100%' }} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface PlaylistSongResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSec: number;
  embeddable: boolean;
  unavailable: boolean;
}

interface PlaylistRowState extends PlaylistSongResult {
  selected: boolean;
  artistName: string;
}

/**
 * 從 YouTube 播放清單網址批次匯入歌曲。讀取整個清單後先讓管理者勾選、確認/修改每首歌對應的
 * 歌手名稱（預設用影片頻道名稱猜測，常常就是正確答案，但翻唱/合輯頻道需要手動修正），
 * 而不是直接無腦全部匯入——播放清單裡常常混雜非目標內容（純音樂視覺化影片、幕後花絮等），
 * 讓管理者有機會篩選比較安全。實際寫入資料庫的邏輯直接複用既有的 CSV 匯入 API，
 * 不重新實作一套寫入邏輯，避免兩邊行為兜不起來。
 */
function YouTubePlaylistImportAccordion({ onImported, onNotice }: { onImported: () => void; onNotice: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [rows, setRows] = useState<PlaylistRowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  async function handleFetch() {
    if (url.trim().length === 0) return;
    setLoading(true);
    setError(null);
    setRows([]);
    try {
      const res = await fetch(`/api/youtube-playlist?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '讀取播放清單失敗');
        return;
      }
      const results: PlaylistSongResult[] = data.results ?? [];
      setRows(
        results.map((r) => ({
          ...r,
          // 不可用（私人/已刪除）或關閉外部嵌入的項目預設不勾選，避免匯入完全沒辦法在遊戲內播放的歌曲
          selected: !r.unavailable && r.embeddable,
          artistName: r.channelTitle,
        }))
      );
      setTruncated(Boolean(data.truncated));
    } catch (err) {
      setError(err instanceof Error ? err.message : '讀取播放清單失敗');
    } finally {
      setLoading(false);
    }
  }

  function toggleAll(selected: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, selected: r.unavailable ? false : selected })));
  }

  async function handleImportSelected() {
    const selectedRows = rows.filter((r) => r.selected);
    if (selectedRows.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      // 直接複用既有的 CSV 匯入 API，不另外實作一套寫入邏輯；用 Papa.unparse 而非手動字串拼接，
      // 正確處理標題／頻道名稱裡可能包含逗號、引號等字元，避免手動拼接 CSV 產生格式錯誤。
      const csv = Papa.unparse({
        fields: [...SONG_CSV_COLUMNS],
        data: selectedRows.map((r) => [
          r.title,
          r.artistName.trim() || '(未知歌手)',
          r.videoId,
          '',
          '',
          String(r.durationSec),
          '',
          '',
        ]),
      });
      const result = await songRepository.importSongsCsv(csv);
      if (!result.ok || !result.data) {
        setError(result.error ?? '匯入失敗');
        return;
      }
      const { created, updated, duplicates, errors } = result.data.summary;
      onNotice(
        `播放清單匯入完成：新增 ${created} 首、更新 ${updated} 首${duplicates > 0 ? `、略過重複 ${duplicates} 首` : ''}${errors > 0 ? `、失敗 ${errors} 列` : ''}`
      );
      onImported();
      setRows([]);
      setUrl('');
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    <div style={{ border: '1px solid var(--groove)', borderRadius: '10px', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '12px 16px',
          background: 'var(--bg)',
          border: 'none',
          color: 'var(--ink)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: '0.95rem',
        }}
      >
        <span>從 YouTube 播放清單批次匯入</span>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>{open ? '收合 ▲' : '展開 ▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--groove)' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleFetch();
                }
              }}
              placeholder="貼上播放清單網址，例如 https://www.youtube.com/playlist?list=..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" onClick={handleFetch} disabled={loading} style={editButtonStyle}>
              {loading ? '讀取中…' : '讀取清單'}
            </button>
          </div>
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}
          {truncated && (
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
              這個播放清單超過一次能讀取的上限，只載入了前面一部分，其餘需要分次匯入。
            </p>
          )}

          {rows.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
                  共 {rows.length} 首，已選 {selectedCount} 首
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => toggleAll(true)} style={editButtonStyle}>
                    全選
                  </button>
                  <button type="button" onClick={() => toggleAll(false)} style={editButtonStyle}>
                    取消全選
                  </button>
                </div>
              </div>

              <ul
                style={{
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '420px',
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                }}
              >
                {rows.map((r, idx) => (
                  <li
                    key={r.videoId}
                    style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--groove)',
                      opacity: r.unavailable ? 0.5 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={r.selected}
                      disabled={r.unavailable}
                      onChange={(e) =>
                        setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, selected: e.target.checked } : row)))
                      }
                    />
                    {r.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- 縮圖來自 YouTube 外部網域，非本地靜態資源，不適合用 next/image
                      <img src={r.thumbnailUrl} alt="" width={48} height={36} style={{ borderRadius: '4px', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.title}
                      </span>
                      {r.unavailable ? (
                        <span style={{ color: 'var(--error)', fontSize: '0.75rem' }}>影片已私人化或刪除，無法匯入</span>
                      ) : !r.embeddable ? (
                        <span style={{ color: 'var(--error)', fontSize: '0.75rem' }}>擁有者關閉外部嵌入播放，遊戲內會無聲</span>
                      ) : (
                        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem' }}>{formatDuration(r.durationSec)}</span>
                      )}
                    </div>
                    <input
                      value={r.artistName}
                      onChange={(e) =>
                        setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, artistName: e.target.value } : row)))
                      }
                      placeholder="歌手名稱"
                      disabled={r.unavailable}
                      style={{ ...inputStyle, width: '140px', flexShrink: 0 }}
                    />
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={handleImportSelected}
                disabled={importing || selectedCount === 0}
                style={{ ...buttonStyle, alignSelf: 'flex-start' }}
              >
                {importing ? '匯入中…' : `批次匯入所選的 ${selectedCount} 首`}
              </button>
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.75rem' }}>
                歌手名稱預設取自影片頻道名稱，翻唱／合輯／官方頻道名稱常常跟實際歌手不同，匯入前建議逐一確認或修正。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}


interface SongFormState {
  title: string;
  artistId: string;
  youtubeVideoId: string;
  appleMusicTrackId: string;
  appleMusicPreviewUrl: string;
  durationSec: string;
  lyrics: string;
  themeIds: string[];
}

const EMPTY_SONG_FORM: SongFormState = {
  title: '',
  artistId: '',
  youtubeVideoId: '',
  appleMusicTrackId: '',
  appleMusicPreviewUrl: '',
  durationSec: '',
  lyrics: '',
  themeIds: [],
};

function ImportExportBar({
  onImported,
  onError,
  onNotice,
}: {
  onImported: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setLastResult(null);
    try {
      const text = await file.text();
      const result = await songRepository.importSongsCsv(text);
      if (!result.ok || !result.data) {
        onError(result.error ?? '匯入失敗');
        return;
      }
      setLastResult(result.data);
      const { created, updated, duplicates, errors } = result.data.summary;
      onNotice(
        `匯入完成：新增 ${created} 首、更新 ${updated} 首${duplicates > 0 ? `、略過重複 ${duplicates} 首` : ''}${errors > 0 ? `、失敗 ${errors} 列` : ''}`
      );
      onImported();
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px 16px',
        borderRadius: '10px',
        border: '1px solid var(--groove)',
      }}
    >
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 這是觸發檔案下載，不是頁面導覽，用 next/link 會攔截點擊導致下載失效 */}
        <a href="/api/songs/export" style={editButtonStyle}>
          匯出 CSV
        </a>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          style={editButtonStyle}
        >
          {importing ? '匯入中…' : '匯入 CSV'}
        </button>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} style={{ display: 'none' }} />
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          欄位：title, artist, youtubeVideoId, appleMusicTrackId, appleMusicPreviewUrl, durationSec,
          themes（用 ; 分隔多個）, lyrics。youtubeVideoId／appleMusicPreviewUrl 至少要有一欄有值。
          兩者其中一個對到既有資料會被更新；都對不上、但歌名＋歌手都相符時視為重複，會略過不匯入。
        </span>
      </div>

      {lastResult && lastResult.results.some((r) => r.status === 'duplicate') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
          {lastResult.results
            .filter((r) => r.status === 'duplicate')
            .map((r) => (
              <p key={r.row} style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
                第 {r.row} 列（{r.title}）略過：{r.error}
              </p>
            ))}
        </div>
      )}

      {lastResult && lastResult.results.some((r) => r.status === 'error') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
          {lastResult.results
            .filter((r) => r.status === 'error')
            .map((r) => (
              <p key={r.row} style={{ color: 'var(--error)', fontSize: '0.8rem' }}>
                第 {r.row} 列（{r.title}）：{r.error}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

function SongSection({
  songs,
  artists,
  themes,
  onChanged,
  onError,
  onNotice,
}: { songs: Song[]; artists: Artist[]; themes: Theme[] } & SectionCallbacks) {
  const [editing, setEditing] = useState<Song | null>(null);
  const [filterArtistId, setFilterArtistId] = useState<string>('');
  const [filterThemeId, setFilterThemeId] = useState<string>('');
  const [prefill, setPrefill] = useState<YouTubePrefill | null>(null);
  const [applePrefill, setApplePrefill] = useState<AppleMusicPrefill | null>(null);
  // 目前正在試聽的歌曲，一次只展開一個避免畫面雜亂
  const [previewSongId, setPreviewSongId] = useState<string | null>(null);
  // 試聽時要播哪個來源；兩種來源都有的歌曲可以切換比較，判斷 Apple Music 抓到的版本
  // 跟 YouTube 上的版本是不是同一個（例如原唱版 vs 重生版/Live版這類差異）
  const [previewSource, setPreviewSource] = useState<'apple' | 'youtube'>('apple');

  function artistName(id: string) {
    return artists.find((a) => a.id === id)?.name ?? '（未知歌手）';
  }

  // 歌手／主題查詢可以同時使用（交集），跟比賽建立流程的「擇一」不同——
  // 這裡單純是管理頁面找歌曲用的篩選，不是決定比賽題庫，同時縮小範圍反而更好用。
  const visibleSongs = songs.filter(
    (s) =>
      (!filterArtistId || s.artistId === filterArtistId) &&
      (!filterThemeId || s.themeIds.includes(filterThemeId))
  );

  // 歌手清單（artists）內容一變（新增/刪除歌手）就重新掛載表單，
  // 避免表單記住舊的歌手清單快照，導致明明已經新增了歌手，
  // 下面的新增歌曲表單卻還是選不到、或悄悄送到錯的歌手底下。
  const artistsKey = artists.map((a) => a.id).join(',');
  const themesKey = themes.map((t) => t.id).join(',');

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: '1.1rem' }}>歌曲管理（{songs.length}）</h2>

      <ImportExportBar onImported={onChanged} onError={onError} onNotice={onNotice} />

      <YouTubeSearchAccordion onPick={setPrefill} />

      <AppleMusicSearchAccordion onPick={setApplePrefill} />

      <YouTubePlaylistImportAccordion onImported={onChanged} onNotice={onNotice} />

      <SongForm
        key={`${editing?.id ?? 'new'}-${artistsKey}-${themesKey}-${prefill?.videoId ?? ''}-${applePrefill?.trackId ?? ''}`}
        editing={editing}
        artists={artists}
        themes={themes}
        existingSongs={songs}
        prefill={prefill}
        applePrefill={applePrefill}
        onCancel={() => {
          setEditing(null);
          setPrefill(null);
          setApplePrefill(null);
        }}
        onSaved={(msg) => {
          onNotice(msg);
          setEditing(null);
          setPrefill(null);
          setApplePrefill(null);
          onChanged();
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>依歌手查詢：</span>
        <select
          value={filterArtistId}
          onChange={(e) => setFilterArtistId(e.target.value)}
          style={{ ...inputStyle, flex: 1, maxWidth: '200px' }}
        >
          <option value="">全部歌手</option>
          {artists.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>依主題查詢：</span>
        <select
          value={filterThemeId}
          onChange={(e) => setFilterThemeId(e.target.value)}
          style={{ ...inputStyle, flex: 1, maxWidth: '200px' }}
        >
          <option value="">全部主題</option>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {(filterArtistId || filterThemeId) && (
          <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
            {visibleSongs.length} 首
          </span>
        )}
      </div>

      <ul
        style={{
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '420px',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        }}
      >
        {visibleSongs.length === 0 && (
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>此歌手目前無歌曲</p>
        )}
        {visibleSongs.map((s) => (
          <li
            key={s.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid var(--groove)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.title}
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', marginLeft: '8px' }}>
                  {artistName(s.artistId)}
                  {s.appleMusicPreviewUrl && ' · 🍎 Apple Music'}
                  {s.youtubeVideoId && ' · ▶ YouTube'}
                  {!s.appleMusicPreviewUrl && !s.youtubeVideoId && (
                    <span style={{ color: 'var(--error)' }}> · ⚠ 沒有可播放來源</span>
                  )}
                </span>
              </span>
              <span style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button
                  onClick={() => {
                    setPreviewSongId((cur) => (cur === s.id ? null : s.id));
                    // 每次重新打開試聽，優先選 Apple Music（沒有的話退回 YouTube），
                    // 跟資料庫實際播放時的來源優先序一致（見 resolvePlaybackTarget.ts）
                    setPreviewSource(s.appleMusicPreviewUrl ? 'apple' : 'youtube');
                  }}
                  style={editButtonStyle}
                >
                  {previewSongId === s.id ? '收起試聽' : '試聽'}
                </button>
                <button onClick={() => setEditing(s)} style={editButtonStyle}>
                  編輯
                </button>
                <button
                  onClick={async () => {
                    const result = await songRepository.deleteSong(s.id);
                    if (!result.ok) {
                      onError(result.error ?? '刪除歌曲失敗');
                      return;
                    }
                    onNotice('已刪除歌曲');
                    if (editing?.id === s.id) setEditing(null);
                    onChanged();
                  }}
                  style={dangerButtonStyle}
                >
                  刪除
                </button>
              </span>
            </div>
            {previewSongId === s.id && s.appleMusicPreviewUrl && s.youtubeVideoId && (
              // 兩種來源都有時才顯示切換鈕，方便核對 Apple Music 抓到的版本跟 YouTube 上的
              // 是不是同一個版本（原唱 vs 重生版/Live版這類差異，批次查詢時很常遇到）
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setPreviewSource('apple')}
                  style={{
                    ...editButtonStyle,
                    borderColor: previewSource === 'apple' ? 'var(--accent)' : 'var(--groove)',
                    color: previewSource === 'apple' ? 'var(--accent)' : 'var(--ink)',
                  }}
                >
                  🍎 Apple Music
                </button>
                <button
                  onClick={() => setPreviewSource('youtube')}
                  style={{
                    ...editButtonStyle,
                    borderColor: previewSource === 'youtube' ? 'var(--accent)' : 'var(--groove)',
                    color: previewSource === 'youtube' ? 'var(--accent)' : 'var(--ink)',
                  }}
                >
                  ▶ YouTube
                </button>
              </div>
            )}
            {previewSongId === s.id &&
              (previewSource === 'apple' && s.appleMusicPreviewUrl ? (
                <audio controls autoPlay src={s.appleMusicPreviewUrl} style={{ width: '100%' }} />
              ) : s.youtubeVideoId ? (
                <iframe
                  width="100%"
                  height="220"
                  src={`https://www.youtube.com/embed/${s.youtubeVideoId}?autoplay=1`}
                  title={s.title}
                  style={{ border: 'none', borderRadius: '8px' }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : s.appleMusicPreviewUrl ? (
                <audio controls autoPlay src={s.appleMusicPreviewUrl} style={{ width: '100%' }} />
              ) : null)}
          </li>
        ))}
      </ul>
    </section>
  );
}

const NEW_ARTIST_OPTION = '__new_artist__';

function SongForm({
  editing,
  artists,
  themes,
  existingSongs,
  prefill,
  applePrefill,
  onCancel,
  onSaved,
}: {
  editing: Song | null;
  artists: Artist[];
  themes: Theme[];
  existingSongs: Song[];
  prefill: YouTubePrefill | null;
  applePrefill: AppleMusicPrefill | null;
  onCancel: () => void;
  onSaved: (msg: string) => void;
}) {
  const [form, setForm] = useState<SongFormState>(
    editing
      ? {
          title: editing.title,
          artistId: editing.artistId,
          youtubeVideoId: prefill?.videoId ?? editing.youtubeVideoId ?? '',
          appleMusicTrackId: applePrefill?.trackId ?? editing.appleMusicTrackId ?? '',
          appleMusicPreviewUrl: applePrefill?.previewUrl ?? editing.appleMusicPreviewUrl ?? '',
          durationSec: String(prefill?.durationSec ?? applePrefill?.durationSec ?? editing.durationSec),
          lyrics: editing.lyrics,
          themeIds: editing.themeIds,
        }
      : {
          ...EMPTY_SONG_FORM,
          artistId: artists[0]?.id ?? NEW_ARTIST_OPTION,
          youtubeVideoId: prefill?.videoId ?? '',
          appleMusicTrackId: applePrefill?.trackId ?? '',
          appleMusicPreviewUrl: applePrefill?.previewUrl ?? '',
          durationSec: prefill?.durationSec
            ? String(prefill.durationSec)
            : applePrefill?.durationSec
              ? String(applePrefill.durationSec)
              : '',
        }
  );
  // 下拉選單選到「+ 新增歌手…」時，改用這個文字輸入直接打字建立新歌手，
  // 不用先跳去上面的歌手管理區塊新增完再回來選。
  const [newArtistName, setNewArtistName] = useState('');
  // 表單自己的驗證/送出錯誤，顯示在送出按鈕旁邊，而不是丟到頁面最上方（太容易被忽略）
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const title = form.title.trim();
    const youtubeVideoId = form.youtubeVideoId.trim();
    const appleMusicTrackId = form.appleMusicTrackId.trim();
    const appleMusicPreviewUrl = form.appleMusicPreviewUrl.trim();

    // 缺漏檢查：先擋掉基本必填欄位，避免漏填就送出（例如剛剛的 key 重複問題就是資料沒檢查乾淨造成的連鎖症狀）。
    // YouTube／Apple Music 兩種來源至少要有一個，不強制兩個都填——建議優先填 Apple Music
    // （控制中心不會洩漏歌名，見 AppleMusicSearchAccordion 上方的說明），但沒有硬性要求。
    if (title.length === 0 || !form.artistId || (youtubeVideoId.length === 0 && appleMusicPreviewUrl.length === 0)) {
      setFormError('歌名、歌手為必填，且 YouTube videoId／Apple Music 試聽網址至少要有一個');
      return;
    }
    if (form.artistId === NEW_ARTIST_OPTION && newArtistName.trim().length === 0) {
      setFormError('請輸入新歌手的名稱');
      return;
    }

    const durationSec = Number(form.durationSec) || 0;
    if (durationSec <= 0) {
      setFormError('「總長」必須大於 0 才能送出：留空或填 0 會讓 RANDOM_CLIP 模式的片段抽樣失效');
      return;
    }

    // 重複檢查：同一個播放來源（YouTube 影片或 Apple Music 試聽）已經收錄過（不論掛在哪位歌手底下），
    // 或同一位歌手底下已經有同名歌曲，都視為重複，擋下並提示，不靜默覆蓋或重複新增。
    const otherSongs = existingSongs.filter((s) => s.id !== editing?.id);
    const duplicateVideo = youtubeVideoId
      ? otherSongs.find((s) => s.youtubeVideoId === youtubeVideoId)
      : undefined;
    if (duplicateVideo) {
      setFormError(`此 YouTube 影片已經收錄在題庫中（《${duplicateVideo.title}》），請確認是否重複`);
      return;
    }
    const duplicateApple = appleMusicPreviewUrl
      ? otherSongs.find((s) => s.appleMusicPreviewUrl === appleMusicPreviewUrl)
      : undefined;
    if (duplicateApple) {
      setFormError(`此 Apple Music 試聽片段已經收錄在題庫中（《${duplicateApple.title}》），請確認是否重複`);
      return;
    }
    if (form.artistId !== NEW_ARTIST_OPTION) {
      const duplicateTitle = otherSongs.find(
        (s) => s.artistId === form.artistId && s.title.trim() === title
      );
      if (duplicateTitle) {
        setFormError('這位歌手底下已經有一首同名歌曲了，請確認是否重複');
        return;
      }
    }

    let artistId = form.artistId;
    if (artistId === NEW_ARTIST_OPTION) {
      const artistResult = await songRepository.createArtist({ name: newArtistName.trim(), gender: 'UNKNOWN' });
      if (!artistResult.ok || !artistResult.data) {
        setFormError(artistResult.error ?? '新增歌手失敗');
        return;
      }
      artistId = artistResult.data.id;
    }

    const payload = {
      title,
      artistId,
      youtubeVideoId: youtubeVideoId || undefined,
      appleMusicTrackId: appleMusicTrackId || undefined,
      appleMusicPreviewUrl: appleMusicPreviewUrl || undefined,
      durationSec,
      lyrics: form.lyrics,
      themeIds: form.themeIds,
    };

    const result = editing
      ? await songRepository.updateSong(editing.id, payload)
      : await songRepository.createSong(payload);

    if (!result.ok) {
      setFormError(result.error ?? '儲存歌曲失敗');
      return;
    }
    onSaved(editing ? '已更新歌曲' : '已新增歌曲');
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="歌名"
          style={{ ...inputStyle, flex: 2, minWidth: '140px' }}
        />
        <select
          value={form.artistId}
          onChange={(e) => setForm((f) => ({ ...f, artistId: e.target.value }))}
          style={{ ...inputStyle, flex: 1, minWidth: '120px' }}
        >
          {artists.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value={NEW_ARTIST_OPTION}>+ 新增歌手…</option>
        </select>
      </div>

      {form.artistId === NEW_ARTIST_OPTION && (
        <input
          value={newArtistName}
          onChange={(e) => setNewArtistName(e.target.value)}
          placeholder="輸入新歌手／團體名稱"
          style={{ ...inputStyle }}
          autoFocus
        />
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input
          value={form.appleMusicPreviewUrl}
          onChange={(e) => setForm((f) => ({ ...f, appleMusicPreviewUrl: e.target.value }))}
          placeholder="Apple Music 試聽網址（建議優先填，或由上方搜尋帶入）"
          style={{ ...inputStyle, flex: 2, minWidth: '200px' }}
        />
        <input
          value={form.appleMusicTrackId}
          onChange={(e) => setForm((f) => ({ ...f, appleMusicTrackId: e.target.value }))}
          placeholder="Apple Music track id（選填，供之後重新查詢核對用）"
          style={{ ...inputStyle, flex: 1, minWidth: '140px' }}
        />
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input
          value={form.youtubeVideoId}
          onChange={(e) => setForm((f) => ({ ...f, youtubeVideoId: e.target.value }))}
          placeholder="YouTube videoId（非完整網址，或由上方搜尋帶入；沒有 Apple Music 來源時為必填）"
          style={{ ...inputStyle, flex: 2, minWidth: '160px' }}
        />
        <input
          value={form.durationSec}
          onChange={(e) => setForm((f) => ({ ...f, durationSec: e.target.value }))}
          placeholder="總長（秒，可由上方搜尋自動帶入）"
          type="number"
          style={{ ...inputStyle, width: '110px' }}
        />
      </div>
      <textarea
        value={form.lyrics}
        onChange={(e) => setForm((f) => ({ ...f, lyrics: e.target.value }))}
        placeholder="歌詞（供 LYRIC_LINE 模式使用，每行一句；請自行輸入，避免著作權疑慮我方不代為填入）"
        rows={3}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />

      {themes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>主題（可複選，選填）</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {themes.map((t) => {
              const checked = form.themeIds.includes(t.id);
              return (
                <label
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    borderRadius: '999px',
                    border: '1px solid var(--groove)',
                    background: checked ? 'var(--bg-raised)' : 'transparent',
                    fontSize: '0.85rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setForm((f) => ({
                        ...f,
                        themeIds: checked ? f.themeIds.filter((id) => id !== t.id) : [...f.themeIds, t.id],
                      }))
                    }
                  />
                  {t.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" style={buttonStyle}>
          {editing ? '儲存' : '新增歌曲'}
        </button>
        {editing && (
          <button type="button" onClick={onCancel} style={editButtonStyle}>
            取消
          </button>
        )}
        {formError && (
          <span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{formError}</span>
        )}
      </div>
    </form>
  );
}
