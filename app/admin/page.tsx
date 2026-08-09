'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Song } from '../../lib/types/song';
import type { Artist, ArtistGender } from '../../lib/types/theme';
import { songRepository } from '../../lib/repository/songRepository';

const GENDER_OPTIONS: { value: ArtistGender; label: string }[] = [
  { value: 'MALE', label: '男歌手' },
  { value: 'FEMALE', label: '女歌手' },
  { value: 'GROUP', label: '團體' },
  { value: 'UNKNOWN', label: '未分類' },
];

export default function AdminPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [artistList, songList] = await Promise.all([
        songRepository.getAllArtists(),
        songRepository.getAll(),
      ]);
      setArtists(artistList);
      setSongs(songList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '讀取資料失敗');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([songRepository.getAllArtists(), songRepository.getAll()]).then(
      ([artistList, songList]) => {
        if (cancelled) return;
        setArtists(artistList);
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

      <SongSection songs={songs} artists={artists} onChanged={reload} onError={setError} onNotice={flashNotice} />
      <ArtistSection artists={artists} onChanged={reload} onError={setError} onNotice={flashNotice} />

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

interface SongFormState {
  title: string;
  artistId: string;
  youtubeVideoId: string;
  durationSec: string;
  lyrics: string;
}

const EMPTY_SONG_FORM: SongFormState = {
  title: '',
  artistId: '',
  youtubeVideoId: '',
  durationSec: '',
  lyrics: '',
};

function SongSection({
  songs,
  artists,
  onChanged,
  onError,
  onNotice,
}: { songs: Song[]; artists: Artist[] } & SectionCallbacks) {
  const [editing, setEditing] = useState<Song | null>(null);
  const [filterArtistId, setFilterArtistId] = useState<string>('');
  const [prefill, setPrefill] = useState<YouTubePrefill | null>(null);

  function artistName(id: string) {
    return artists.find((a) => a.id === id)?.name ?? '（未知歌手）';
  }

  const visibleSongs = filterArtistId ? songs.filter((s) => s.artistId === filterArtistId) : songs;

  // 歌手清單（artists）內容一變（新增/刪除歌手）就重新掛載表單，
  // 避免表單記住舊的歌手清單快照，導致明明已經新增了歌手，
  // 下面的新增歌曲表單卻還是選不到、或悄悄送到錯的歌手底下。
  const artistsKey = artists.map((a) => a.id).join(',');

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: '1.1rem' }}>歌曲管理（{songs.length}）</h2>

      <YouTubeSearchAccordion onPick={setPrefill} />

      <SongForm
        key={`${editing?.id ?? 'new'}-${artistsKey}-${prefill?.videoId ?? ''}`}
        editing={editing}
        artists={artists}
        existingSongs={songs}
        prefill={prefill}
        onCancel={() => {
          setEditing(null);
          setPrefill(null);
        }}
        onSaved={(msg) => {
          onNotice(msg);
          setEditing(null);
          setPrefill(null);
          onChanged();
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>依歌手查詢：</span>
        <select
          value={filterArtistId}
          onChange={(e) => setFilterArtistId(e.target.value)}
          style={{ ...inputStyle, flex: 1, maxWidth: '240px' }}
        >
          <option value="">全部歌手</option>
          {artists.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {filterArtistId && (
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
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid var(--groove)',
              gap: '8px',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.title}
              <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', marginLeft: '8px' }}>
                {artistName(s.artistId)} · {s.youtubeVideoId}
              </span>
            </span>
            <span style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
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
  existingSongs,
  prefill,
  onCancel,
  onSaved,
}: {
  editing: Song | null;
  artists: Artist[];
  existingSongs: Song[];
  prefill: YouTubePrefill | null;
  onCancel: () => void;
  onSaved: (msg: string) => void;
}) {
  const [form, setForm] = useState<SongFormState>(
    editing
      ? {
          title: editing.title,
          artistId: editing.artistId,
          youtubeVideoId: prefill?.videoId ?? editing.youtubeVideoId,
          durationSec: String(prefill?.durationSec ?? editing.durationSec),
          lyrics: editing.lyrics,
        }
      : {
          ...EMPTY_SONG_FORM,
          artistId: artists[0]?.id ?? NEW_ARTIST_OPTION,
          youtubeVideoId: prefill?.videoId ?? '',
          durationSec: prefill?.durationSec ? String(prefill.durationSec) : '',
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

    // 缺漏檢查：先擋掉基本必填欄位，避免漏填就送出（例如剛剛的 key 重複問題就是資料沒檢查乾淨造成的連鎖症狀）
    if (title.length === 0 || !form.artistId || youtubeVideoId.length === 0) {
      setFormError('歌名、歌手、YouTube videoId 為必填');
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

    // 重複檢查：同一支 YouTube 影片已經收錄過（不論掛在哪位歌手底下），
    // 或同一位歌手底下已經有同名歌曲，兩種都視為重複，擋下並提示，不靜默覆蓋或重複新增。
    const otherSongs = existingSongs.filter((s) => s.id !== editing?.id);
    const duplicateVideo = otherSongs.find((s) => s.youtubeVideoId === youtubeVideoId);
    if (duplicateVideo) {
      setFormError(`此 YouTube 影片已經收錄在題庫中（《${duplicateVideo.title}》），請確認是否重複`);
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
      youtubeVideoId,
      durationSec,
      lyrics: form.lyrics,
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
          value={form.youtubeVideoId}
          onChange={(e) => setForm((f) => ({ ...f, youtubeVideoId: e.target.value }))}
          placeholder="YouTube videoId（非完整網址，或由上方搜尋帶入）"
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
