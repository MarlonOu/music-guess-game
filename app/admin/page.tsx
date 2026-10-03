'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import type { Song } from '../../lib/types/song';
import type { Artist, ArtistGender, Theme } from '../../lib/types/theme';
import { songRepository, type ImportSummary } from '../../lib/repository/songRepository';
import { SONG_CSV_COLUMNS, ALIAS_LIST_SEPARATOR } from '../../lib/csv/songCsv';

const GENDER_OPTIONS: { value: ArtistGender; label: string }[] = [
  { value: 'MALE', label: '男歌手' },
  { value: 'FEMALE', label: '女歌手' },
  { value: 'GROUP', label: '團體' },
  { value: 'UNKNOWN', label: '未分類' },
];

/**
 * 摺疊/展開指示用的小 chevron，取代這個頁面裡原本複製貼上五次的「▲」「▼」文字字元——
 * 文字字元沒有過場動畫，狀態切換時是硬生生的瞬間替換；這裡用 SVG 配合 transform 旋轉，
 * 展開/收合之間有一個小小的轉動過場，跟其他頁面（速通模式排行榜、線上模式 QR Code）
 * 的摺疊按鈕是同一套做法，整站的「這是一個可以展開的東西」視覺語言統一。
 */
function CollapseChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      style={{
        flexShrink: 0,
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease',
      }}
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.75rem' }}>資料庫管理</h1>
      </motion.header>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ color: 'var(--error)' }}
          >
            {error}
          </motion.p>
        )}
        {notice && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ color: 'var(--success)' }}
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

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

// 這四個共用樣式常數對齊全站統一的按鈕／輸入框系統（見 app/globals.css 最下方的說明），
// 保留成 JS 常數（而不是直接改成 className）是因為底下有 50 多處呼叫端會用
// style={{ ...editButtonStyle, 額外的排版覆寫 }} 這種寫法疊加個別的 flex/寬度調整，
// 直接改動每一處風險較高；改成從這幾個常數集中定義視覺樣式，效果等同全站統一，
// 同時把「按鈕排版微調」跟「按鈕視覺風格」兩件事分開，各自的呼叫端不用逐一修改。
const inputStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: '10px',
  border: '1px solid var(--groove)',
  background: 'var(--bg-raised)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-body)',
  fontSize: '1rem',
};

// 對應 .btn-primary：畫面裡最主要的動作（新增歌手／歌曲、送出表單）
const buttonStyle: React.CSSProperties = {
  padding: '12px 22px',
  borderRadius: '10px',
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  fontWeight: 600,
  fontSize: '0.95rem',
};

// 對應 .btn-danger .btn-sm：破壞性操作（刪除），紅色描邊、不用實心填滿避免視覺恐慌
const dangerButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: '1px solid var(--error)',
  background: 'transparent',
  color: 'var(--error)',
  fontSize: '0.85rem',
  fontWeight: 500,
};

// 對應 .btn-ghost .btn-sm：中性的次要操作（編輯、搜尋、試聽、匯入匯出、全選）；
// 這裡也是清單裡各種「切換選中狀態」按鈕的基底樣式，呼叫端會另外 spread 疊加
// borderColor／color 依選中狀態切換（例如試聽來源切換、搶答方式切換），
// 疊加時使用的顏色也統一對齊 var(--accent) 表示選中、var(--groove)／var(--ink-dim) 表示未選中。
const editButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: '1px solid var(--groove)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: '0.85rem',
  fontWeight: 500,
};

/**
 * 刪除動作的確認按鈕——原本三個刪除動作（歌手／歌曲／主題）都是點了就立刻送出刪除請求，
 * 沒有任何確認，手滑點到就直接刪掉、沒有回頭路。改成點第一下先在原地展開成「確定要
 * 刪除「X」嗎？」的確認文字＋兩顆按鈕，要再點一次「確定刪除」才會真的送出，點「取消」
 * 或點其他地方都能收回——這裡故意不用跳出來的 modal 對話框，而是直接在原本按鈕的位置
 * 展開，操作起來比較輕量，也不需要處理 modal 常見的焦點鎖定、背景捲動鎖定這些額外複雜度，
 * 對一個行數不多、单纯要確認「是不是真的要刪」的場景來說已經足夠。
 */
function ConfirmDeleteButton({ confirmText, onConfirm }: { confirmText: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--error)', fontSize: '0.8rem' }}>{confirmText}</span>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
          style={dangerButtonStyle}
        >
          確定刪除
        </button>
        <button type="button" onClick={() => setConfirming(false)} style={editButtonStyle}>
          取消
        </button>
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} style={dangerButtonStyle}>
      刪除
    </button>
  );
}

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
              <ConfirmDeleteButton
                confirmText={`確定要刪除歌手「${a.name}」嗎？`}
                onConfirm={async () => {
                  const result = await songRepository.deleteArtist(a.id);
                  if (!result.ok) {
                    onError(result.error ?? '刪除歌手失敗');
                    return;
                  }
                  onNotice('已刪除歌手');
                  if (editing?.id === a.id) setEditing(null);
                  onChanged();
                }}
              />
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
            <ConfirmDeleteButton
              confirmText={`確定要刪除主題「${t.name}」嗎？`}
              onConfirm={async () => {
                const result = await songRepository.deleteTheme(t.id);
                if (!result.ok) {
                  onError(result.error ?? '刪除主題失敗');
                  return;
                }
                onNotice('已刪除主題');
                onChanged();
              }}
            />
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
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          {open ? '收合' : '展開'}
          <CollapseChevron open={open} />
        </span>
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
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          {open ? '收合' : '展開'}
          <CollapseChevron open={open} />
        </span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--groove)' }}>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
            Apple Music 官方試聽片段用同源 &lt;audio&gt; 播放，不會有控制中心洩漏歌名的問題（YouTube 是跨網域第三方播放器，這點沒辦法完全避免）。
            <br />
            只會用在「隨機片段猜歌」模式——試聽片段是官方精選的一小段（常常直接是副歌），不保證是歌曲開頭，「前奏猜歌」模式一律仍用 YouTube 播放真正的前奏。
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

interface DeezerSearchResult {
  trackId: string;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  durationSec: number;
  previewUrl: string;
}

interface DeezerPrefill {
  trackId: string;
  previewUrl: string;
  durationSec: number;
}

/**
 * 跟 AppleMusicSearchAccordion 同樣的設計，搜尋 Deezer 的試聽來源。這是 Apple Music 目錄
 * 沒收錄這首歌時的第二層備援（見 resolvePlaybackTarget.ts 的優先序說明），建議先搜過
 * Apple Music、找不到再來這裡搜，兩個目錄不完全重疊，各自會有對方沒有的冷門/地區限定歌曲。
 */
function DeezerSearchAccordion({ onPick }: { onPick: (result: DeezerPrefill) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DeezerSearchResult[]>([]);
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
      const res = await fetch(`/api/deezer-search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Deezer 搜尋失敗');
        setResults([]);
        return;
      }
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deezer 搜尋失敗');
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
        <span>從 Deezer 搜尋試聽來源（Apple Music 找不到時的備援）</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          {open ? '收合' : '展開'}
          <CollapseChevron open={open} />
        </span>
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
                      // eslint-disable-next-line @next/next/no-img-element -- 外部 Deezer 封面圖，非本地靜態資源，不適用 next/image 最佳化
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
  // 每一列各自的主題——播放清單常常是混雜內容（精選輯、各種歌手/年代混在一起），
  // 不能假設整份清單都該套用同一個主題，所以主題是跟著每一列單獨存放，不是整個
  // accordion 共用一個值。下面「套用主題給已勾選匯入的列」這個功能，本質上只是
  // 「幫目前每一列的 themeIds 設定同一個起始值」，設定完管理者仍然可以對任何一列
  // 個別勾掉/加上其他主題，兩種操作方式不衝突、是同一份狀態的兩種編輯入口。
  themeIds: string[];
  // 這個影片對應的 youtubeVideoId 如果已經存在資料庫裡，代表這首歌先前已經匯入過；
  // 在匯入前就先標出來，不用等按下「批次匯入」才在結果裡發現「略過重複」，
  // 也能讓管理者提前決定要不要連這幾首一起取消勾選、不送出重複的匯入請求。
  alreadyExists: boolean;
}

/**
 * 從 YouTube 播放清單網址批次匯入歌曲。讀取整個清單後先讓管理者勾選、確認/修改每首歌對應的
 * 歌手名稱（預設用影片頻道名稱猜測，常常就是正確答案，但翻唱/合輯頻道需要手動修正），
 * 而不是直接無腦全部匯入——播放清單裡常常混雜非目標內容（純音樂視覺化影片、幕後花絮等），
 * 讓管理者有機會篩選比較安全。實際寫入資料庫的邏輯直接複用既有的 CSV 匯入 API，
 * 不重新實作一套寫入邏輯，避免兩邊行為兜不起來。
 */
function YouTubePlaylistImportAccordion({
  themes,
  existingSongs,
  onImported,
  onNotice,
}: {
  themes: Theme[];
  existingSongs: Song[];
  onImported: () => void;
  onNotice: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [rows, setRows] = useState<PlaylistRowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // 「快速套用」的暫存選取——這一組主題不是最終答案，只是拿來一次設定目前已勾選匯入
  // 的每一列各自的 themeIds 起始值（見下面 applyThemesToSelected）。播放清單常常混雜
  // 內容（精選輯裡有各種歌手、各種年代混在一起），不能假設整份清單都該套用同一個主題，
  // 所以真正的狀態是存在每一列自己的 themeIds 裡，這裡的 quickApplyThemeIds 只是加速
  // 設定起始值用的暫存——適合「大部分都一樣，少數幾首不同」的情況：先全部套用一次，
  // 再對那幾首例外個別調整，不用 50 首都從頭勾一遍。
  const [quickApplyThemeIds, setQuickApplyThemeIds] = useState<string[]>([]);
  const themeNameById = new Map(themes.map((t) => [t.id, t.name]));
  const existingVideoIds = new Set(existingSongs.map((s) => s.youtubeVideoId).filter(Boolean));

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
        results.map((r) => {
          const alreadyExists = existingVideoIds.has(r.videoId);
          return {
            ...r,
            // 不可用（私人/已刪除）、關閉外部嵌入、或資料庫裡已經有的項目預設不勾選——
            // 已存在的這首歌再匯入一次只會在批次匯入 API 裡被判定成重複而略過，
            // 預先幫管理者把這些排除掉，省去「匯入完才在結果列表裡發現某幾首是重複」
            // 這一輪來回，也不會因為這些已存在的列佔住版面而混淆「真正還沒匯入」的有幾首。
            selected: !r.unavailable && r.embeddable && !alreadyExists,
            artistName: r.channelTitle,
            themeIds: [],
            alreadyExists,
          };
        })
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

  function toggleRowTheme(idx: number, themeId: string) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const has = row.themeIds.includes(themeId);
        return { ...row, themeIds: has ? row.themeIds.filter((id) => id !== themeId) : [...row.themeIds, themeId] };
      })
    );
  }

  // 把目前勾選的 quickApplyThemeIds 設成「所有已勾選匯入的列」的 themeIds 起始值——
  // 這裡是直接「取代」，不是像已存在歌曲的批次套用那樣用「疊加」：這些列都還只是
  // 匯入前的暫存狀態、還沒真的寫進資料庫，取代不會弄丟任何已經存在的資料，而且
  // 「重新點一次快速套用、換個主題組合覆蓋掉剛剛的選擇」本身就該是立即生效、
  // 所見即所得的操作，不需要像修改既有資料那樣保守。
  function applyThemesToSelected() {
    if (quickApplyThemeIds.length === 0) return;
    setRows((prev) => prev.map((r) => (r.selected ? { ...r, themeIds: [...quickApplyThemeIds] } : r)));
  }

  async function handleImportSelected() {
    const selectedRows = rows.filter((r) => r.selected);
    if (selectedRows.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      // 直接複用既有的 CSV 匯入 API，不另外實作一套寫入邏輯；用 Papa.unparse 而非手動字串拼接，
      // 正確處理標題／頻道名稱裡可能包含逗號、引號等字元，避免手動拼接 CSV 產生格式錯誤。
      // 這裡改成用「欄位名稱→值」的物件逐一對應，不再是一個手動對齊 SONG_CSV_COLUMNS
      // 15 個欄位順序的純陣列——先前那個版本陣列長度（13 個元素）跟欄位數對不上，
      // r.durationSec 實際落在了 deezerSkip 這個布林欄位的位置，真正的 durationSec
      // 欄位反而是空的。這個 bug 造成的實際影響：durationSec 空白會讓 RANDOM_CLIP
      // 模式退回固定 8 秒起播（見 lib/engine/modes/randomClipMode.ts 的防呆邏輯），
      // 等於「隨機片段猜歌」對所有用播放清單匯入的歌曲，永遠只會從 0 秒開始播，
      // 完全失去「隨機」這件事——用物件寫法即使之後 SONG_CSV_COLUMNS 的順序調整，
      // 這裡也不會因為數錯位置又重演同一種 bug。
      const csv = Papa.unparse({
        fields: [...SONG_CSV_COLUMNS],
        data: selectedRows.map((r) => {
          const row: Record<(typeof SONG_CSV_COLUMNS)[number], string> = {
            title: r.title,
            artist: r.artistName.trim() || '(未知歌手)',
            aliases: '',
            youtubeVideoId: r.videoId,
            appleMusicTrackId: '',
            appleMusicPreviewUrl: '',
            appleMusicSkip: '',
            appleMusicVerified: '',
            deezerTrackId: '',
            deezerPreviewUrl: '',
            deezerSkip: '',
            deezerVerified: '',
            durationSec: String(r.durationSec),
            themes: r.themeIds.map((id) => themeNameById.get(id)).filter(Boolean).join(ALIAS_LIST_SEPARATOR),
            lyrics: '',
          };
          return SONG_CSV_COLUMNS.map((col) => row[col]);
        }),
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
      setQuickApplyThemeIds([]);
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
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          {open ? '收合' : '展開'}
          <CollapseChevron open={open} />
        </span>
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
                  {rows.some((r) => r.alreadyExists) && `（${rows.filter((r) => r.alreadyExists).length} 首資料庫裡已經有了，預設不勾選）`}
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

              {/* 快速套用：播放清單常常混雜內容，不能假設整份都該套用同一個主題，所以這裡
                  套用的對象是「目前已勾選匯入的列」，套用後還能在下面清單個別調整每一列——
                  適合「大部分都一樣、少數例外」的情況：先全部套用一次起始值，再挑出例外
                  個別修正，不用 50 首從頭勾一遍。真正混雜到每首都不同的情況，直接跳過這裡，
                  在下面清單逐列設定即可。 */}
              {themes.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>快速套用主題到已勾選的列：</span>
                  {themes.map((t) => {
                    const checked = quickApplyThemeIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '5px 10px',
                          borderRadius: '999px',
                          border: '1px solid var(--groove)',
                          background: checked ? 'var(--bg-raised)' : 'transparent',
                          fontSize: '0.8rem',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setQuickApplyThemeIds((prev) =>
                              checked ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                            )
                          }
                        />
                        {t.name}
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    onClick={applyThemesToSelected}
                    disabled={quickApplyThemeIds.length === 0}
                    style={editButtonStyle}
                  >
                    套用到已勾選的 {selectedCount} 首
                  </button>
                </div>
              )}

              <ul
                style={{
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '480px',
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                }}
              >
                {rows.map((r, idx) => (
                  <li
                    key={r.videoId}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--groove)',
                      opacity: r.unavailable ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
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
                        ) : r.alreadyExists ? (
                          <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem' }}>資料庫裡已經有這首了</span>
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
                    </div>
                    {/* 每一列各自的主題勾選——跟上面「快速套用」是同一份狀態（r.themeIds）的
                        兩個編輯入口，快速套用負責設起始值，這裡負責個別微調或是從零逐首設定。 */}
                    {themes.length > 0 && !r.unavailable && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', paddingLeft: '26px' }}>
                        {themes.map((t) => {
                          const checked = r.themeIds.includes(t.id);
                          return (
                            <label
                              key={t.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                border: '1px solid var(--groove)',
                                background: checked ? 'var(--bg)' : 'transparent',
                                color: checked ? 'var(--accent)' : 'var(--ink-dim)',
                                borderColor: checked ? 'var(--accent)' : 'var(--groove)',
                                fontSize: '0.72rem',
                              }}
                            >
                              <input type="checkbox" checked={checked} onChange={() => toggleRowTheme(idx, t.id)} style={{ width: '11px', height: '11px' }} />
                              {t.name}
                            </label>
                          );
                        })}
                      </div>
                    )}
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
  appleMusicSkip: boolean;
  appleMusicVerified: boolean;
  deezerTrackId: string;
  deezerPreviewUrl: string;
  deezerSkip: boolean;
  deezerVerified: boolean;
  aliases: string[];
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
  appleMusicSkip: false,
  appleMusicVerified: false,
  deezerTrackId: '',
  deezerPreviewUrl: '',
  deezerSkip: false,
  deezerVerified: false,
  aliases: [],
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
          欄位：title, artist, aliases（其他也算答對的說法，用 ; 分隔多個，選填）, youtubeVideoId,
          appleMusicTrackId, appleMusicPreviewUrl, appleMusicSkip, appleMusicVerified, deezerTrackId,
          deezerPreviewUrl, deezerSkip, deezerVerified, durationSec, themes（用 ; 分隔多個）, lyrics。
          youtubeVideoId／appleMusicPreviewUrl／deezerPreviewUrl 至少要有一欄有值。
          appleMusicSkip／deezerSkip 填 true 代表「已確認這個平台找不到，批次腳本不要再自動搜尋」；
          appleMusicVerified／deezerVerified 填 true 代表「已人工核對過這個來源是正確的，批次腳本
          --force 重新整理過期網址時也要跳過，不要覆蓋」。其餘值都當作未勾選。
          其中一個來源對到既有資料會被更新；都對不上、但歌名＋歌手都相符時視為重複，會略過不匯入。
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
  const [deezerPrefill, setDeezerPrefill] = useState<DeezerPrefill | null>(null);
  // 目前正在試聽的歌曲，一次只展開一個避免畫面雜亂
  const [previewSongId, setPreviewSongId] = useState<string | null>(null);
  // 試聽時要播哪個來源；有多種來源的歌曲可以切換比較，判斷 Apple Music／Deezer 抓到的版本
  // 跟 YouTube 上的版本是不是同一個（例如原唱版 vs 重生版/Live版這類差異）
  const [previewSource, setPreviewSource] = useState<'apple' | 'deezer' | 'youtube'>('apple');

  function artistName(id: string) {
    return artists.find((a) => a.id === id)?.name ?? '（未知歌手）';
  }

  function themeName(id: string) {
    return themes.find((t) => t.id === id)?.name ?? '（已刪除的主題）';
  }

  function hasNoPlayableSource(s: Song) {
    return !s.appleMusicPreviewUrl && !s.deezerPreviewUrl && !s.youtubeVideoId;
  }

  // 「健康檢查」快速篩選——跟上面依歌手／主題查詢是不同性質的篩選：那兩個是「我知道
  // 我要找什麼」，這個是「我想知道題庫裡有哪些地方還沒處理好」。這是這次重構實際要解決
  // 的操作情境：批次匯入一份播放清單之後，這些歌通常還沒有指定主題，先前的做法完全沒有
  // 入口能一次看到「所有缺主題的歌曲」，只能一首一首點開編輯表單才看得出來這首有沒有主題，
  // 50 首歌要這樣檢查一遍非常低效。「沒有可播放來源」這個情況原本雖然在每一列上有畫出
  // 一個小小的 ⚠ 警示文字，但一樣沒有辦法「只看這些有問題的」，長長的清單裡要找出
  // 這幾首淹沒在其他正常的歌曲中間，一樣得整份捲動著找。
  const [healthFilter, setHealthFilter] = useState<'none' | 'no-theme' | 'no-source'>('none');
  const songsWithoutTheme = songs.filter((s) => s.themeIds.length === 0);
  const songsWithoutSource = songs.filter(hasNoPlayableSource);

  // 批次選取＋批次套用主題——跟上面播放清單批次匯入時「匯入當下就選好主題」是同一個
  // 情境的另一半：那邊解決的是「剛匯入、還沒進資料庫」的情況，這裡解決的是「已經在
  // 資料庫裡、事後才發現沒有主題」的情況（例如用 CSV 匯入的舊資料、或透過上面健康檢查
  // 篩選找出來的）。選取跟套用動作分開管理：selectedSongIds 記錄目前勾選了哪些歌曲，
  // 不受篩選條件切換影響（切換篩選不會清空已選的，讓管理者可以切換篩選、累積跨好幾種
  // 條件選出來的歌曲，一次套用，不用因為篩選一變就重選）。
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());
  const [bulkThemeIds, setBulkThemeIds] = useState<string[]>([]);
  const [bulkApplying, setBulkApplying] = useState(false);

  function toggleSongSelected(id: string) {
    setSelectedSongIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkThemes() {
    if (selectedSongIds.size === 0 || bulkThemeIds.length === 0) return;
    setBulkApplying(true);
    try {
      // 這裡是「新增」不是「取代」——選取的主題會疊加到每首歌原本已經有的主題上面
      // （用 Set 去重複，避免同一首歌剛好已經有其中一個主題時被重複加一次），
      // 不會把歌曲原本已經有、但這次沒勾選的主題清掉。這是比較安全的預設行為：
      // 「批次補上缺的主題」遠比「批次覆蓋掉所有歌曲的主題設定」常見得多，誤觸的
      // 代價也小很多——不小心多加了一個主題，之後要移除也只要個別點開拿掉即可；
      // 如果預設是取代，不小心選錯歌曲範圍，會直接把原本的主題資料覆蓋不見。
      const targets = songs.filter((s) => selectedSongIds.has(s.id));
      let failCount = 0;
      for (const song of targets) {
        const mergedThemeIds = Array.from(new Set([...song.themeIds, ...bulkThemeIds]));
        const result = await songRepository.updateSong(song.id, {
          title: song.title,
          artistId: song.artistId,
          youtubeVideoId: song.youtubeVideoId ?? '',
          appleMusicTrackId: song.appleMusicTrackId ?? '',
          appleMusicPreviewUrl: song.appleMusicPreviewUrl ?? '',
          appleMusicSkip: song.appleMusicSkip,
          appleMusicVerified: song.appleMusicVerified,
          deezerTrackId: song.deezerTrackId ?? '',
          deezerPreviewUrl: song.deezerPreviewUrl ?? '',
          deezerSkip: song.deezerSkip,
          deezerVerified: song.deezerVerified,
          aliases: song.aliases,
          durationSec: song.durationSec,
          lyrics: song.lyrics,
          themeIds: mergedThemeIds,
        });
        if (!result.ok) failCount++;
      }
      if (failCount > 0) {
        onError(`批次套用主題時有 ${failCount} 首失敗，其餘已成功`);
      } else {
        onNotice(`已為 ${targets.length} 首歌套用主題`);
      }
      setSelectedSongIds(new Set());
      setBulkThemeIds([]);
      onChanged();
    } finally {
      setBulkApplying(false);
    }
  }

  // 歌手／主題查詢可以同時使用（交集），跟比賽建立流程的「擇一」不同——
  // 這裡單純是管理頁面找歌曲用的篩選，不是決定比賽題庫，同時縮小範圍反而更好用。
  // 健康檢查篩選（healthFilter）也是交集疊加上去，不是取代前面兩個篩選——例如可以同時
  // 「依歌手篩選＋只看沒有主題的」，縮小到剛好要處理的那一小批。
  const visibleSongs = songs.filter(
    (s) =>
      (!filterArtistId || s.artistId === filterArtistId) &&
      (!filterThemeId || s.themeIds.includes(filterThemeId)) &&
      (healthFilter === 'none' ||
        (healthFilter === 'no-theme' && s.themeIds.length === 0) ||
        (healthFilter === 'no-source' && hasNoPlayableSource(s)))
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

      <DeezerSearchAccordion onPick={setDeezerPrefill} />

      <YouTubePlaylistImportAccordion themes={themes} existingSongs={songs} onImported={onChanged} onNotice={onNotice} />

      <SongForm
        key={`${editing?.id ?? 'new'}-${artistsKey}-${themesKey}-${prefill?.videoId ?? ''}-${applePrefill?.trackId ?? ''}-${deezerPrefill?.trackId ?? ''}`}
        editing={editing}
        artists={artists}
        themes={themes}
        existingSongs={songs}
        prefill={prefill}
        applePrefill={applePrefill}
        deezerPrefill={deezerPrefill}
        onCancel={() => {
          setEditing(null);
          setPrefill(null);
          setApplePrefill(null);
          setDeezerPrefill(null);
        }}
        onSaved={(msg) => {
          onNotice(msg);
          setEditing(null);
          setPrefill(null);
          setApplePrefill(null);
          setDeezerPrefill(null);
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

      {/* 健康檢查快速篩選：按鈕上直接標數量，不用點下去才知道有多少筆要處理——
          數量是 0 的話代表這個項目「全部都處理好了」，直接讓按鈕呈現停用狀態，
          不會讓管理者點了一個篩選、結果清單空空如也還要猜是不是沒有問題。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>健康檢查：</span>
        <button
          type="button"
          disabled={songsWithoutTheme.length === 0}
          onClick={() => setHealthFilter((f) => (f === 'no-theme' ? 'none' : 'no-theme'))}
          style={{
            ...editButtonStyle,
            opacity: songsWithoutTheme.length === 0 ? 0.4 : 1,
            borderColor: healthFilter === 'no-theme' ? 'var(--accent)' : 'var(--groove)',
            color: healthFilter === 'no-theme' ? 'var(--accent)' : 'var(--ink)',
          }}
        >
          沒有主題的歌（{songsWithoutTheme.length}）
        </button>
        <button
          type="button"
          disabled={songsWithoutSource.length === 0}
          onClick={() => setHealthFilter((f) => (f === 'no-source' ? 'none' : 'no-source'))}
          style={{
            ...editButtonStyle,
            opacity: songsWithoutSource.length === 0 ? 0.4 : 1,
            borderColor: healthFilter === 'no-source' ? 'var(--accent)' : 'var(--groove)',
            color: healthFilter === 'no-source' ? 'var(--accent)' : 'var(--ink)',
          }}
        >
          沒有可播放來源（{songsWithoutSource.length}）
        </button>
      </div>

      {/* 批次操作列：有選取歌曲時才顯示，不佔用平常瀏覽清單時的版面。「全選目前這份清單」
          特意只選「目前篩選後看得到的」，不是選資料庫裡全部的歌——這樣先篩出「沒有主題
          的歌」、按全選，選到的剛好就是真正需要處理的那批，不用擔心不小心選到篩選範圍
          以外、其實已經有主題的歌曲。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setSelectedSongIds(new Set(visibleSongs.map((s) => s.id)))} style={editButtonStyle}>
          全選目前這份清單（{visibleSongs.length}）
        </button>
        {selectedSongIds.size > 0 && (
          <button type="button" onClick={() => setSelectedSongIds(new Set())} style={editButtonStyle}>
            清除選取
          </button>
        )}
      </div>

      {selectedSongIds.size > 0 && themes.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid var(--accent)',
            background: 'var(--bg-raised)',
          }}
        >
          <span style={{ fontSize: '0.85rem' }}>已選 {selectedSongIds.size} 首，批次套用主題（疊加在原本的主題上，不會取代）</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {themes.map((t) => {
              const checked = bulkThemeIds.includes(t.id);
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
                    background: checked ? 'var(--bg)' : 'transparent',
                    fontSize: '0.85rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setBulkThemeIds((prev) => (checked ? prev.filter((id) => id !== t.id) : [...prev, t.id]))
                    }
                  />
                  {t.name}
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={applyBulkThemes}
            disabled={bulkApplying || bulkThemeIds.length === 0}
            style={{ ...buttonStyle, alignSelf: 'flex-start' }}
          >
            {bulkApplying ? '套用中…' : `套用到所選的 ${selectedSongIds.size} 首`}
          </button>
        </div>
      )}

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
              border: selectedSongIds.has(s.id) ? '1px solid var(--accent)' : '1px solid var(--groove)',
              background: selectedSongIds.has(s.id) ? 'var(--bg-raised)' : 'transparent',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                {/* 勾選框放在最前面，用來做批次選取（見上方「批次套用主題」的完整說明）——
                    勾選狀態不受篩選切換影響，連選取本身也會讓這一列的邊框整個亮起來，
                    不是只有小小的勾選框打勾，長長的清單裡才能一眼看出「這幾列是我選的」。 */}
                <input
                  type="checkbox"
                  checked={selectedSongIds.has(s.id)}
                  onChange={() => toggleSongSelected(s.id)}
                  aria-label={`選取「${s.title}」`}
                  style={{ flexShrink: 0 }}
                />
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={s.title}
                >
                  {s.title}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                {/* 來源圖示：由左至右固定是 Apple／Deezer／YouTube，每個都是固定寬度的格子，
                    沒有這個來源就格子留空、不畫圖示，而不是把格子整個拿掉——這樣不管這首歌
                    實際有幾個來源，圖示在清單每一列上下都會對齊在同樣的水平位置，一眼掃過去
                    就看得出「這一整批歌大概都有齊 Apple／Deezer」還是「這幾首偏偏缺了 Deezer」。
                    放在試聽按鈕左邊、跟按鈕們一起垂直置中，是同一組「這首歌的播放相關資訊」，
                    擺在一起比分成兩行更容易一眼看懂。 */}
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem' }}>
                  <span style={{ width: '16px', textAlign: 'center' }} title="Apple Music">
                    {s.appleMusicPreviewUrl ? '🍎' : ''}
                  </span>
                  <span style={{ color: 'var(--groove)' }}>|</span>
                  <span style={{ width: '16px', textAlign: 'center' }} title="Deezer">
                    {s.deezerPreviewUrl ? '🎵' : ''}
                  </span>
                  <span style={{ color: 'var(--groove)' }}>|</span>
                  <span style={{ width: '16px', textAlign: 'center' }} title="YouTube">
                    {s.youtubeVideoId ? '▶' : ''}
                  </span>
                </span>
                <button
                  onClick={() => {
                    setPreviewSongId((cur) => (cur === s.id ? null : s.id));
                    // 每次重新打開試聽，依資料庫實際播放時的來源優先序（見 resolvePlaybackTarget.ts）
                    // 挑一個目前這首歌有的來源：Apple Music → Deezer → YouTube
                    setPreviewSource(s.appleMusicPreviewUrl ? 'apple' : s.deezerPreviewUrl ? 'deezer' : 'youtube');
                  }}
                  style={editButtonStyle}
                >
                  {previewSongId === s.id ? '收起試聽' : '試聽'}
                </button>
                <button onClick={() => setEditing(s)} style={editButtonStyle}>
                  編輯
                </button>
                <ConfirmDeleteButton
                  confirmText={`確定要刪除「${s.title}」嗎？`}
                  onConfirm={async () => {
                    const result = await songRepository.deleteSong(s.id);
                    if (!result.ok) {
                      onError(result.error ?? '刪除歌曲失敗');
                      return;
                    }
                    onNotice('已刪除歌曲');
                    if (editing?.id === s.id) setEditing(null);
                    onChanged();
                  }}
                />
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {artistName(s.artistId)}
                {hasNoPlayableSource(s) && <span style={{ color: 'var(--error)' }}> · ⚠ 沒有可播放來源</span>}
              </span>
              {/* 主題標籤：原本清單裡完全看不出每首歌有沒有指定主題、指定了哪些，
                  要點開編輯表單才看得到。這裡直接把主題用小標籤列出來，掃過清單
                  就能看出「這一批都還沒給主題」或「這幾首主題給錯了」，不用逐首點開。
                  沒有主題的歌曲額外用警示色顯示文字，呼應上面「沒有可播放來源」
                  同一種視覺語言——兩者都是「這筆資料還缺東西」。 */}
              {s.themeIds.length > 0 ? (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {s.themeIds.map((id) => (
                    <span
                      key={id}
                      style={{
                        fontSize: '0.72rem',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        border: '1px solid var(--groove)',
                        color: 'var(--ink-dim)',
                      }}
                    >
                      {themeName(id)}
                    </span>
                  ))}
                </span>
              ) : (
                <span style={{ fontSize: '0.78rem', color: 'var(--error)' }}>⚠ 沒有主題</span>
              )}
            </div>
            {previewSongId === s.id &&
              [s.appleMusicPreviewUrl, s.deezerPreviewUrl, s.youtubeVideoId].filter(Boolean).length > 1 && (
                // 兩種以上來源都有時才顯示切換鈕，方便核對不同平台抓到的版本是不是同一個
                // （原唱 vs 重生版/Live版這類差異，批次查詢時很常遇到）
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {s.appleMusicPreviewUrl && (
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
                  )}
                  {s.deezerPreviewUrl && (
                    <button
                      onClick={() => setPreviewSource('deezer')}
                      style={{
                        ...editButtonStyle,
                        borderColor: previewSource === 'deezer' ? 'var(--accent)' : 'var(--groove)',
                        color: previewSource === 'deezer' ? 'var(--accent)' : 'var(--ink)',
                      }}
                    >
                      🎵 Deezer
                    </button>
                  )}
                  {s.youtubeVideoId && (
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
                  )}
                </div>
              )}
            {previewSongId === s.id &&
              (() => {
                // 依目前選定的來源播放；選定的那個來源這首歌剛好沒有時（例如切換過去但這首歌
                // 沒有 Deezer 來源），依優先序自動退回下一個可用的，不會顯示空白一片。
                const source =
                  previewSource === 'apple' && s.appleMusicPreviewUrl
                    ? 'apple'
                    : previewSource === 'deezer' && s.deezerPreviewUrl
                      ? 'deezer'
                      : previewSource === 'youtube' && s.youtubeVideoId
                        ? 'youtube'
                        : s.appleMusicPreviewUrl
                          ? 'apple'
                          : s.deezerPreviewUrl
                            ? 'deezer'
                            : s.youtubeVideoId
                              ? 'youtube'
                              : null;

                if (source === 'apple') {
                  return <audio controls autoPlay src={s.appleMusicPreviewUrl!} style={{ width: '100%' }} />;
                }
                if (source === 'deezer') {
                  return <audio controls autoPlay src={s.deezerPreviewUrl!} style={{ width: '100%' }} />;
                }
                if (source === 'youtube') {
                  return (
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
                  );
                }
                return null;
              })()}
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
  deezerPrefill,
  onCancel,
  onSaved,
}: {
  editing: Song | null;
  artists: Artist[];
  themes: Theme[];
  existingSongs: Song[];
  prefill: YouTubePrefill | null;
  applePrefill: AppleMusicPrefill | null;
  deezerPrefill: DeezerPrefill | null;
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
          // 剛從搜尋結果選了一筆新的來源，代表管理者已經找到真正的來源了，
          // 之前設定的「已確認沒有」標記就不該再成立，自動清掉；沒有選新結果的話維持原值。
          appleMusicSkip: applePrefill ? false : editing.appleMusicSkip,
          // 同理，剛選的這筆是從搜尋結果挑的（不是管理者專程人工核對過的），之前的「已人工核對」
          // 標記是對應到「原本那個網址」，不該自動沿用到這個新選的網址上，要管理者自己重新確認、
          // 重新勾選才算數——避免「verified」這個標記被誤套用到一個其實還沒人工核對過的新網址。
          appleMusicVerified: applePrefill ? false : editing.appleMusicVerified,
          deezerTrackId: deezerPrefill?.trackId ?? editing.deezerTrackId ?? '',
          deezerPreviewUrl: deezerPrefill?.previewUrl ?? editing.deezerPreviewUrl ?? '',
          deezerSkip: deezerPrefill ? false : editing.deezerSkip,
          deezerVerified: deezerPrefill ? false : editing.deezerVerified,
          aliases: editing.aliases,
          durationSec: String(
            prefill?.durationSec ?? applePrefill?.durationSec ?? deezerPrefill?.durationSec ?? editing.durationSec
          ),
          lyrics: editing.lyrics,
          themeIds: editing.themeIds,
        }
      : {
          ...EMPTY_SONG_FORM,
          artistId: artists[0]?.id ?? NEW_ARTIST_OPTION,
          youtubeVideoId: prefill?.videoId ?? '',
          appleMusicTrackId: applePrefill?.trackId ?? '',
          appleMusicPreviewUrl: applePrefill?.previewUrl ?? '',
          deezerTrackId: deezerPrefill?.trackId ?? '',
          deezerPreviewUrl: deezerPrefill?.previewUrl ?? '',
          durationSec: prefill?.durationSec
            ? String(prefill.durationSec)
            : applePrefill?.durationSec
              ? String(applePrefill.durationSec)
              : deezerPrefill?.durationSec
                ? String(deezerPrefill.durationSec)
                : '',
        }
  );
  // 下拉選單選到「+ 新增歌手…」時，改用這個文字輸入直接打字建立新歌手，
  // 不用先跳去上面的歌手管理區塊新增完再回來選。
  const [newArtistName, setNewArtistName] = useState('');
  // 別名清單的新增輸入框（見下方「答案比對」區塊）
  const [newAlias, setNewAlias] = useState('');
  // Apple/Deezer 的 track id 純粹是給批次腳本重新查詢核對用，日常編輯很少需要看到，
  // 預設收起來，表單不會一次塞滿太多欄位；已經有值的話（例如舊資料本來就填過）預設展開，
  // 避免管理者以為那筆資料不見了。
  const [showAdvancedSourceFields, setShowAdvancedSourceFields] = useState(
    Boolean(editing?.appleMusicTrackId || editing?.deezerTrackId)
  );
  // 表單自己的驗證/送出錯誤，顯示在送出按鈕旁邊，而不是丟到頁面最上方（太容易被忽略）
  const [formError, setFormError] = useState<string | null>(null);

  function addAlias() {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    if (form.aliases.includes(trimmed)) {
      setNewAlias('');
      return;
    }
    setForm((f) => ({ ...f, aliases: [...f.aliases, trimmed] }));
    setNewAlias('');
  }

  function removeAlias(alias: string) {
    setForm((f) => ({ ...f, aliases: f.aliases.filter((a) => a !== alias) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const title = form.title.trim();
    const youtubeVideoId = form.youtubeVideoId.trim();
    const appleMusicTrackId = form.appleMusicTrackId.trim();
    const appleMusicPreviewUrl = form.appleMusicPreviewUrl.trim();
    const deezerTrackId = form.deezerTrackId.trim();
    const deezerPreviewUrl = form.deezerPreviewUrl.trim();

    // 缺漏檢查：先擋掉基本必填欄位，避免漏填就送出（例如剛剛的 key 重複問題就是資料沒檢查乾淨造成的連鎖症狀）。
    // YouTube／Apple Music／Deezer 三種來源至少要有一個，不強制全部都填——建議優先填 Apple Music
    // 或 Deezer（控制中心不會洩漏歌名，見 AppleMusicSearchAccordion 上方的說明），但沒有硬性要求。
    if (
      title.length === 0 ||
      !form.artistId ||
      (youtubeVideoId.length === 0 && appleMusicPreviewUrl.length === 0 && deezerPreviewUrl.length === 0)
    ) {
      setFormError('歌名、歌手為必填，且 YouTube videoId／Apple Music／Deezer 試聽網址至少要有一個');
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

    // 重複檢查：同一個播放來源已經收錄過（不論掛在哪位歌手底下），
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
    const duplicateDeezer = deezerPreviewUrl
      ? otherSongs.find((s) => s.deezerPreviewUrl === deezerPreviewUrl)
      : undefined;
    if (duplicateDeezer) {
      setFormError(`此 Deezer 試聽片段已經收錄在題庫中（《${duplicateDeezer.title}》），請確認是否重複`);
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

    // 這裡刻意直接送出 trim 過的值（可能是空字串），不要再用 `|| undefined` 把空字串轉成
    // undefined——之前那樣寫會導致 JSON.stringify 送出請求時，把值是 undefined 的欄位整個
    // 拿掉，讓伺服器收到的請求裡根本沒有這個欄位，被誤判成「這個欄位沒有被觸碰、維持原值」，
    // 導致清空 Apple/Deezer 來源存檔後其實沒有真的清空、還是保留舊值。這個表單每次送出
    // 本來就是完整的一組欄位（不是只想更新其中幾個的局部更新），直接把目前欄位的實際值
    // （可能是空字串）送出去，伺服器那邊看到空字串就會正確地把該欄位存成 null。
    const payload = {
      title,
      artistId,
      youtubeVideoId,
      appleMusicTrackId,
      appleMusicPreviewUrl,
      appleMusicSkip: form.appleMusicSkip,
      appleMusicVerified: form.appleMusicVerified,
      deezerTrackId,
      deezerPreviewUrl,
      deezerSkip: form.deezerSkip,
      deezerVerified: form.deezerVerified,
      aliases: form.aliases,
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
      {/* ===== 基本資訊 ===== */}
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
        <input
          value={form.durationSec}
          onChange={(e) => setForm((f) => ({ ...f, durationSec: e.target.value }))}
          placeholder="總長（秒）"
          type="number"
          style={{ ...inputStyle, width: '110px' }}
        />
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

      {/* ===== 播放來源 ===== */}
      <div style={{ borderTop: '1px solid var(--groove)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', fontWeight: 600 }}>
          播放來源（YouTube／Apple Music／Deezer 至少要有一個）
        </span>

        <input
          value={form.youtubeVideoId}
          onChange={(e) => setForm((f) => ({ ...f, youtubeVideoId: e.target.value }))}
          placeholder="YouTube videoId（非完整網址，或由上方搜尋帶入）"
          style={inputStyle}
        />

        <input
          value={form.appleMusicPreviewUrl}
          onChange={(e) => setForm((f) => ({ ...f, appleMusicPreviewUrl: e.target.value }))}
          placeholder="Apple Music 試聽網址（建議優先填，或由上方搜尋帶入）"
          style={inputStyle}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          <input
            type="checkbox"
            checked={form.appleMusicSkip}
            onChange={(e) => setForm((f) => ({ ...f, appleMusicSkip: e.target.checked }))}
          />
          已確認 Apple Music 上真的找不到這首歌（不要讓批次腳本再自動搜尋補上）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          <input
            type="checkbox"
            checked={form.appleMusicVerified}
            onChange={(e) => setForm((f) => ({ ...f, appleMusicVerified: e.target.checked }))}
          />
          已人工核對過，這個 Apple Music 來源就是正確版本（批次腳本用 --force 重新整理過期網址時跳過這首歌）
        </label>

        <input
          value={form.deezerPreviewUrl}
          onChange={(e) => setForm((f) => ({ ...f, deezerPreviewUrl: e.target.value }))}
          placeholder="Deezer 試聽網址（Apple Music 找不到時的備援，或由上方搜尋帶入）"
          style={inputStyle}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          <input
            type="checkbox"
            checked={form.deezerSkip}
            onChange={(e) => setForm((f) => ({ ...f, deezerSkip: e.target.checked }))}
          />
          已確認 Deezer 上真的找不到這首歌（不要讓批次腳本再自動搜尋補上）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          <input
            type="checkbox"
            checked={form.deezerVerified}
            onChange={(e) => setForm((f) => ({ ...f, deezerVerified: e.target.checked }))}
          />
          已人工核對過，這個 Deezer 來源就是正確版本（批次腳本用 --force 重新整理過期網址時跳過這首歌）
        </label>

        <button
          type="button"
          onClick={() => setShowAdvancedSourceFields((v) => !v)}
          style={{ ...editButtonStyle, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {showAdvancedSourceFields ? '收起 track id 欄位' : '顯示 track id 欄位（選填，供重新查詢核對用）'}
          <CollapseChevron open={showAdvancedSourceFields} />
        </button>
        {showAdvancedSourceFields && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              value={form.appleMusicTrackId}
              onChange={(e) => setForm((f) => ({ ...f, appleMusicTrackId: e.target.value }))}
              placeholder="Apple Music track id"
              style={{ ...inputStyle, flex: 1, minWidth: '140px' }}
            />
            <input
              value={form.deezerTrackId}
              onChange={(e) => setForm((f) => ({ ...f, deezerTrackId: e.target.value }))}
              placeholder="Deezer track id"
              style={{ ...inputStyle, flex: 1, minWidth: '140px' }}
            />
          </div>
        )}
      </div>

      {/* ===== 答案比對 ===== */}
      <div style={{ borderTop: '1px solid var(--groove)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', fontWeight: 600 }}>
          別名（其他也算答對的說法，選填）
        </span>
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.78rem', margin: 0 }}>
          用在「歌名有多種常見叫法」的情況——例如官方標題是「好好（想把你寫成一首歌）」但大家平常
          簡稱「好好」、純英文譯名、常見暱稱、繁簡體差異等。玩家答對 title 本身或任何一筆別名都算對，
          純文字比對，不需要打完整標點符號（見下方比對規則說明）。
        </p>
        {form.aliases.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {form.aliases.map((alias) => (
              <span
                key={alias}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  borderRadius: '999px',
                  border: '1px solid var(--groove)',
                  fontSize: '0.85rem',
                }}
              >
                {alias}
                <button
                  type="button"
                  onClick={() => removeAlias(alias)}
                  aria-label={`移除別名「${alias}」`}
                  style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAlias();
              }
            }}
            placeholder="輸入別名後按 Enter 或點新增"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="button" onClick={addAlias} style={editButtonStyle}>
            新增
          </button>
        </div>
      </div>

      {/* ===== 歌詞 ===== */}
      <div style={{ borderTop: '1px solid var(--groove)', paddingTop: '10px' }}>
        <textarea
          value={form.lyrics}
          onChange={(e) => setForm((f) => ({ ...f, lyrics: e.target.value }))}
          placeholder="歌詞（供 LYRIC_LINE 模式使用，每行一句；請自行輸入，避免著作權疑慮我方不代為填入）"
          rows={3}
          style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

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
