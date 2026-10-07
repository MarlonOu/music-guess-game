'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import type { Song } from '../../lib/types/song';
import type { Artist, ArtistGender, Theme } from '../../lib/types/theme';
import { songRepository, type ImportSummary } from '../../lib/repository/songRepository';
import { SONG_CSV_COLUMNS, ALIAS_LIST_SEPARATOR } from '../../lib/csv/songCsv';
import {
  artistHintsFor,
  buildSongMatchIndex,
  findSongMatch,
  isDuplicateMatch,
  suggestArtistName,
  suggestSongFields,
  type SongMatch,
} from '../../lib/engine/songMatch';

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
      <ArtistSection artists={artists} songs={songs} onChanged={reload} onError={setError} onNotice={flashNotice} />
      <ThemeSection themes={themes} songs={songs} onChanged={reload} onError={setError} onNotice={flashNotice} />

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

/**
 * 把一首既有歌曲轉成「更新歌曲」API 需要的完整欄位，再套用這次想改的欄位。
 * 更新歌曲 API 是整筆覆蓋式的，只想改一個欄位（例如只標記「已核對」）也得把其他欄位
 * 原樣帶上，不然沒帶的欄位會被清空。這份欄位清單原本在批次套用主題、歌手合併各自抄了
 * 一份，現在核對功能又要用，統一收斂在這裡，之後新增歌曲欄位只需要改一個地方。
 */
function songToUpdateInput(
  song: Song,
  overrides: Partial<Omit<Song, 'id' | 'createdAt'>> = {}
): Partial<Omit<Song, 'id' | 'createdAt'>> {
  return {
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
    themeIds: song.themeIds,
    ...overrides,
  };
}

/**
 * 一首歌的「來源核對狀態」：
 * - none：沒有任何 Apple Music／Deezer 試聽來源（只靠 YouTube 或根本沒來源），沒有東西需要核對
 * - unverified：至少有一個 Apple Music／Deezer 來源還沒被人工核對過，是「待核對佇列」的對象
 * - verified：所有現有的 Apple Music／Deezer 來源都已經人工核對過
 * YouTube 來源沒有核對標記（它是管理者自己貼的影片，不是批次腳本自動比對出來的），不列入判斷。
 */
type SourceReviewStatus = 'none' | 'unverified' | 'verified';

type HealthFilter = 'none' | 'no-theme' | 'no-source' | 'unverified' | 'verified';

function sourceReviewStatus(s: Song): SourceReviewStatus {
  const hasApple = Boolean(s.appleMusicPreviewUrl);
  const hasDeezer = Boolean(s.deezerPreviewUrl);
  if (!hasApple && !hasDeezer) return 'none';
  const appleOk = !hasApple || s.appleMusicVerified;
  const deezerOk = !hasDeezer || s.deezerVerified;
  return appleOk && deezerOk ? 'verified' : 'unverified';
}

type PreviewSource = 'apple' | 'deezer' | 'youtube';

/** 想聽的來源這首歌剛好沒有時，依實際播放優先序（Apple → Deezer → YouTube）退回下一個可用的。 */
function resolvePreviewSource(s: Song, preferred: PreviewSource): PreviewSource | null {
  if (preferred === 'apple' && s.appleMusicPreviewUrl) return 'apple';
  if (preferred === 'deezer' && s.deezerPreviewUrl) return 'deezer';
  if (preferred === 'youtube' && s.youtubeVideoId) return 'youtube';
  if (s.appleMusicPreviewUrl) return 'apple';
  if (s.deezerPreviewUrl) return 'deezer';
  if (s.youtubeVideoId) return 'youtube';
  return null;
}

/** 歌曲清單的「試聽」展開區跟核對佇列共用同一個播放器，確保兩邊聽到的是同一套來源邏輯。 */
function SongPreviewPlayer({ song, source }: { song: Song; source: PreviewSource | null }) {
  if (source === 'apple' && song.appleMusicPreviewUrl) {
    return <audio key={`${song.id}-apple`} controls autoPlay src={song.appleMusicPreviewUrl} style={{ width: '100%' }} />;
  }
  if (source === 'deezer' && (song.deezerPlayUrl || song.deezerPreviewUrl)) {
    // 優先用站內解析路徑：存在資料庫的 Deezer 網址帶時效簽章，常常已經過期
    return <audio key={`${song.id}-deezer`} controls autoPlay src={song.deezerPlayUrl || song.deezerPreviewUrl} style={{ width: '100%' }} />;
  }
  if (source === 'youtube' && song.youtubeVideoId) {
    return (
      <iframe
        key={`${song.id}-youtube`}
        width="100%"
        height="220"
        src={`https://www.youtube.com/embed/${song.youtubeVideoId}?autoplay=1`}
        title={song.title}
        style={{ border: 'none', borderRadius: '8px' }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    );
  }
  return null;
}

/** 清單來源圖示右下角的小勾勾，只在「已人工核對」時出現，掃過清單一眼就能分出核對過的。 */
function VerifiedTick() {
  return (
    <span
      aria-label="已人工核對"
      style={{
        position: 'absolute',
        right: '-5px',
        bottom: '-4px',
        fontSize: '0.62rem',
        fontWeight: 700,
        lineHeight: 1,
        color: 'var(--success)',
      }}
    >
      ✓
    </span>
  );
}

/** 跟 ConfirmDeleteButton 同樣的「原地展開確認」互動，給不是刪除、但影響範圍較大的操作用。 */
function ConfirmActionButton({
  label,
  confirmText,
  confirmLabel = '確定',
  disabled,
  onConfirm,
}: {
  label: string;
  confirmText: string;
  confirmLabel?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>{confirmText}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
          style={buttonStyle}
        >
          {confirmLabel}
        </button>
        <button type="button" onClick={() => setConfirming(false)} style={editButtonStyle}>
          取消
        </button>
      </span>
    );
  }
  return (
    <button type="button" disabled={disabled} onClick={() => setConfirming(true)} style={editButtonStyle}>
      {label}
    </button>
  );
}

/**
 * 來源核對佇列：把「待核對」從「去編輯表單裡找一個勾選框」變成一條可以連續處理的流程。
 *
 * 批次腳本自動比對出來的 Apple Music／Deezer 來源（尤其標記「低信心」的）需要人工聽過
 * 確認是不是原唱正式版，這是整個題庫維護裡最耗時的重複性工作，原本每一首都得：找到那首歌
 * → 點試聽 → 聽完 → 點編輯 → 捲到表單最下面 → 勾「已人工核對」→ 儲存 → 再回清單找下一首。
 * 這裡改成一次只顯示一首待核對的歌，播放器直接在畫面上，聽完按一下就核對並自動帶出下一首。
 * 版本不對的情況也在同一個畫面處理：清空錯的來源並標記「確認找不到」，或直接跳去編輯重新搜尋。
 */
function SourceReviewQueue({
  songs,
  artistNameOf,
  onEdit,
  onChanged,
  onError,
  onNotice,
}: {
  songs: Song[];
  artistNameOf: (artistId: string) => string;
  onEdit: (song: Song) => void;
} & SectionCallbacks) {
  const [open, setOpen] = useState(false);
  // 本次工作階段先略過的歌曲（例如要等一下查資料才能判斷的），只存在這個畫面的狀態裡，
  // 不寫進資料庫——重新整理頁面就會回到佇列裡，不會因為「略過」就永遠消失、被遺忘。
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [pref, setPref] = useState<{ songId: string; source: PreviewSource } | null>(null);
  const [busy, setBusy] = useState(false);

  const queue = songs.filter((s) => sourceReviewStatus(s) === 'unverified');
  const pending = queue.filter((s) => !skippedIds.has(s.id));
  const current = pending[0] ?? null;
  const skippedCount = queue.length - pending.length;

  // 預設先播「還沒核對」的那個來源：如果這首歌 Apple Music 已經核對過、只剩 Deezer 沒核對，
  // 核對完 Apple 之後畫面會自動切到 Deezer，不用再手動切換。
  const defaultSource: PreviewSource = current
    ? current.appleMusicPreviewUrl && !current.appleMusicVerified
      ? 'apple'
      : current.deezerPreviewUrl && !current.deezerVerified
        ? 'deezer'
        : 'apple'
    : 'apple';
  const preferred: PreviewSource = current && pref?.songId === current.id ? pref.source : defaultSource;
  const activeSource = current ? resolvePreviewSource(current, preferred) : null;

  async function patchSong(song: Song, overrides: Partial<Omit<Song, 'id' | 'createdAt'>>, message: string) {
    setBusy(true);
    try {
      const result = await songRepository.updateSong(song.id, songToUpdateInput(song, overrides));
      if (!result.ok) {
        onError(result.error ?? '更新失敗');
        return;
      }
      onNotice(message);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const appleNeeds = Boolean(current?.appleMusicPreviewUrl && !current.appleMusicVerified);
  const deezerNeeds = Boolean(current?.deezerPreviewUrl && !current.deezerVerified);
  const availableSources: PreviewSource[] = current
    ? [
        ...(current.appleMusicPreviewUrl ? (['apple'] as const) : []),
        ...(current.deezerPreviewUrl ? (['deezer'] as const) : []),
        ...(current.youtubeVideoId ? (['youtube'] as const) : []),
      ]
    : [];
  const sourceLabel: Record<PreviewSource, string> = { apple: 'Apple Music', deezer: 'Deezer', youtube: 'YouTube' };

  return (
    <div style={{ border: `1px solid ${queue.length > 0 ? 'var(--accent)' : 'var(--groove)'}`, borderRadius: '10px', overflow: 'hidden' }}>
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
        <span>
          來源核對佇列
          <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: queue.length > 0 ? 'var(--accent)' : 'var(--ink-dim)' }}>
            {queue.length > 0 ? `待核對 ${queue.length} 首` : '全部核對完了'}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          {open ? '收合' : '展開'}
          <CollapseChevron open={open} />
        </span>
      </button>

      {open && (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--groove)' }}>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', margin: 0 }}>
            逐首聽批次腳本自動比對出來的 Apple Music／Deezer 來源，聽起來是同一首原唱版本就按「正確」，版本不對（翻唱、Live、Remix）就清空或重新找。
            核對過的歌曲，之後批次腳本如果需要重新搜尋比對，會跳過、不會被蓋掉。
          </p>

          {skippedCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
              本次已略過 {skippedCount} 首（重新整理頁面也會回到佇列）
              <button type="button" onClick={() => setSkippedIds(new Set())} style={editButtonStyle}>
                把略過的放回佇列
              </button>
            </div>
          )}

          {!current && (
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              {queue.length === 0 ? '目前沒有待核對的來源。' : '剩下的歌曲都被你略過了，可以按上方「把略過的放回佇列」重新處理。'}
            </p>
          )}

          {current && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.78rem' }}>
                  第 1 首／待核對 {pending.length} 首
                </span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{current.title}</span>
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
                  {artistNameOf(current.artistId)}
                  {current.durationSec > 0 && ` · ${formatDuration(current.durationSec)}`}
                </span>
                <span style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.78rem' }}>
                  {current.appleMusicPreviewUrl && (
                    <span style={{ color: current.appleMusicVerified ? 'var(--success)' : 'var(--accent)' }}>
                      Apple Music：{current.appleMusicVerified ? '已核對' : '待核對'}
                    </span>
                  )}
                  {current.deezerPreviewUrl && (
                    <span style={{ color: current.deezerVerified ? 'var(--success)' : 'var(--accent)' }}>
                      Deezer：{current.deezerVerified ? '已核對' : '待核對'}
                    </span>
                  )}
                </span>
              </div>

              {availableSources.length > 1 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {availableSources.map((src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setPref({ songId: current.id, source: src })}
                      style={{
                        ...editButtonStyle,
                        borderColor: activeSource === src ? 'var(--accent)' : 'var(--groove)',
                        color: activeSource === src ? 'var(--accent)' : 'var(--ink)',
                      }}
                    >
                      {sourceLabel[src]}
                    </button>
                  ))}
                </div>
              )}

              <SongPreviewPlayer song={current} source={activeSource} />
              {availableSources.length > 1 && (
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem' }}>
                  可以切到 YouTube 拿原曲對照，確認 Apple Music／Deezer 這個版本是不是同一首。
                </span>
              )}

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {appleNeeds && deezerNeeds && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      patchSong(current, { appleMusicVerified: true, deezerVerified: true }, `已核對「${current.title}」`)
                    }
                    style={buttonStyle}
                  >
                    ✓ 兩個來源都正確
                  </button>
                )}
                {appleNeeds && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patchSong(current, { appleMusicVerified: true }, `已核對「${current.title}」的 Apple Music 來源`)}
                    style={deezerNeeds ? editButtonStyle : buttonStyle}
                  >
                    ✓ Apple Music 來源正確
                  </button>
                )}
                {deezerNeeds && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patchSong(current, { deezerVerified: true }, `已核對「${current.title}」的 Deezer 來源`)}
                    style={appleNeeds ? editButtonStyle : buttonStyle}
                  >
                    ✓ Deezer 來源正確
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => onEdit(current)} style={editButtonStyle}>
                  重新找來源
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setSkippedIds((prev) => new Set(prev).add(current.id))}
                  style={editButtonStyle}
                >
                  略過這首
                </button>
              </div>

              {(appleNeeds || deezerNeeds) && (
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {appleNeeds && (
                    <ConfirmActionButton
                      label="Apple Music 來源是錯的"
                      confirmText="清空 Apple Music 來源並標記「確認找不到」？批次腳本之後不會再替這首歌搜尋 Apple Music。"
                      confirmLabel="清空並標記"
                      disabled={busy}
                      onConfirm={() =>
                        patchSong(
                          current,
                          { appleMusicTrackId: '', appleMusicPreviewUrl: '', appleMusicSkip: true, appleMusicVerified: false },
                          `已清空「${current.title}」的 Apple Music 來源`
                        )
                      }
                    />
                  )}
                  {deezerNeeds && (
                    <ConfirmActionButton
                      label="Deezer 來源是錯的"
                      confirmText="清空 Deezer 來源並標記「確認找不到」？批次腳本之後不會再替這首歌搜尋 Deezer。"
                      confirmLabel="清空並標記"
                      disabled={busy}
                      onConfirm={() =>
                        patchSong(
                          current,
                          { deezerTrackId: '', deezerPreviewUrl: '', deezerSkip: true, deezerVerified: false },
                          `已清空「${current.title}」的 Deezer 來源`
                        )
                      }
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SectionCallbacks {
  onChanged: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}

function ArtistSection({
  artists,
  songs,
  onChanged,
  onError,
  onNotice,
}: { artists: Artist[]; songs: Song[] } & SectionCallbacks) {
  const [editing, setEditing] = useState<Artist | null>(null);
  // 文字搜尋——跟歌曲清單用同一個理由：歌手一多（破百很常見），長長的清單只能捲動找，
  // 沒有辦法直接打名字跳過去。
  const [search, setSearch] = useState('');

  function songCountFor(artistId: string) {
    return songs.filter((s) => s.artistId === artistId).length;
  }

  const visibleArtists = artists.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()));

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

      {artists.length > 1 && (
        <ArtistMergeAccordion artists={artists} songs={songs} onChanged={onChanged} onError={onError} onNotice={onNotice} />
      )}

      {artists.length > 8 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋歌手名稱"
          style={inputStyle}
        />
      )}

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
        {visibleArtists.length === 0 && <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>沒有符合的歌手</p>}
        {visibleArtists.map((a) => {
          const count = songCountFor(a.id);
          return (
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
                  {/* 歌曲數量標在這裡——刪除歌手前，先讓管理者知道這個動作「影響範圍」有多大。
                      後端雖然已經用外鍵擋住「底下還有歌曲就不能刪」，但那是刪了才知道會失敗，
                      這裡讓管理者點刪除之前就先看得到數字，不用真的點下去試一次才知道。 */}
                  {' · '}
                  {count} 首歌
                </span>
              </span>
              <span style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setEditing(a)} style={editButtonStyle}>
                  編輯
                </button>
                <ConfirmDeleteButton
                  confirmText={
                    count > 0
                      ? `「${a.name}」底下還有 ${count} 首歌，必須先清空或轉移才能刪除，確定要嘗試嗎？`
                      : `確定要刪除歌手「${a.name}」嗎？`
                  }
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
          );
        })}
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

/**
 * 合併重複歌手——不小心把同一位歌手拆成兩筆資料是很容易發生的手誤：批次匯入時猜錯了
 * 頻道名稱、或手動輸入時正式名稱跟簡稱打成了兩個不同條目（「五月天」vs「Mayday」、
 * 「盧廣仲」vs「盧廣仲 Crowd Lu」），導致同一位歌手的歌曲分散掛在兩筆歌手資料底下，
 * 篩選題庫、看歌手底下歌曲清單時都會各看到一半。原本完全沒有辦法處理這種情況——
 * 只能把其中一筆底下的歌曲一首一首點開編輯表單改成另一個歌手，改完才能刪掉空的那筆。
 *
 * 這裡直接複用既有的「更新歌曲」「刪除歌手」API，不另外新增後端合併邏輯：把來源歌手
 * 底下所有歌曲的 artistId 一一改成目標歌手，改完來源歌手底下自然就沒有歌曲了，
 * 再呼叫刪除歌手——這兩個 API 本來就存在、也都已經測試過，重新組合出新功能比重新
 * 寫一套後端合併邏輯風險更低。
 */
function ArtistMergeAccordion({
  artists,
  songs,
  onChanged,
  onError,
  onNotice,
}: { artists: Artist[]; songs: Song[] } & SectionCallbacks) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [merging, setMerging] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const sourceSongCount = songs.filter((s) => s.artistId === sourceId).length;
  const sourceArtist = artists.find((a) => a.id === sourceId);
  const targetArtist = artists.find((a) => a.id === targetId);
  // 目標選單排除掉目前選的來源，避免選到同一個——合併一個歌手到它自己沒有意義。
  const targetOptions = artists.filter((a) => a.id !== sourceId);

  async function handleMerge() {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setMerging(true);
    try {
      const songsToMove = songs.filter((s) => s.artistId === sourceId);
      let failCount = 0;
      for (const song of songsToMove) {
        const result = await songRepository.updateSong(song.id, songToUpdateInput(song, { artistId: targetId }));
        if (!result.ok) failCount++;
      }
      if (failCount > 0) {
        onError(`合併時有 ${failCount} 首歌轉移失敗，來源歌手暫不刪除，請檢查後再試一次`);
        onChanged();
        return;
      }
      // 全部轉移成功，來源歌手底下現在沒有歌曲了，可以安全刪除。
      const deleteResult = await songRepository.deleteArtist(sourceId);
      if (!deleteResult.ok) {
        onError(deleteResult.error ?? '歌曲已全部轉移，但刪除原本的歌手失敗，請手動刪除');
        onChanged();
        return;
      }
      onNotice(`已把「${sourceArtist?.name}」的 ${songsToMove.length} 首歌併入「${targetArtist?.name}」`);
      setSourceId('');
      setTargetId('');
      onChanged();
    } finally {
      setMerging(false);
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
        <span>合併重複歌手</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          {open ? '收合' : '展開'}
          <CollapseChevron open={open} />
        </span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--groove)' }}>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', margin: 0 }}>
            如果同一位歌手不小心被拆成兩筆資料（例如正式名稱跟簡稱各建立了一筆），在這裡把其中一筆的歌曲全部轉移到另一筆，轉移完來源那筆會自動刪除。
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setConfirming(false); }} style={{ ...inputStyle, flex: 1, minWidth: '160px' }}>
              <option value="">選擇要合併掉的歌手…</option>
              {artists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}（{songs.filter((s) => s.artistId === a.id).length} 首）
                </option>
              ))}
            </select>
            <span style={{ color: 'var(--ink-dim)' }}>併入 →</span>
            <select
              value={targetId}
              onChange={(e) => { setTargetId(e.target.value); setConfirming(false); }}
              disabled={!sourceId}
              style={{ ...inputStyle, flex: 1, minWidth: '160px' }}
            >
              <option value="">選擇要保留的歌手…</option>
              {targetOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {sourceId && targetId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {!confirming ? (
                <button type="button" onClick={() => setConfirming(true)} style={buttonStyle}>
                  {sourceSongCount > 0
                    ? `把「${sourceArtist?.name}」的 ${sourceSongCount} 首歌轉移到「${targetArtist?.name}」`
                    : `刪除「${sourceArtist?.name}」（底下沒有歌曲）並合併`}
                </button>
              ) : (
                <>
                  <span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>
                    確定嗎？「{sourceArtist?.name}」這筆資料會被刪除，{sourceSongCount} 首歌會改掛在「{targetArtist?.name}」底下，這個動作無法復原。
                  </span>
                  <button type="button" onClick={handleMerge} disabled={merging} style={dangerButtonStyle}>
                    {merging ? '合併中…' : '確定合併'}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} style={editButtonStyle}>
                    取消
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
  songs,
  onChanged,
  onError,
  onNotice,
}: { themes: Theme[]; songs: Song[] } & SectionCallbacks) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // 原本主題只能新增／刪除，沒有編輯——改名字或補充說明只能刪掉重建，刪掉重建又會讓
  // 所有已經指派這個主題的歌曲全部跟著失去這個主題（主題跟歌曲的關聯是透過主題 id
  // 關聯的，刪除主題會連帶清掉這些關聯，見 app/api/themes/[id]/route.ts 的說明），
  // 等於「只是想把『90年代金曲』改名成『90s金曲』」這種單純的改名動作，會意外波及
  // 所有底下的歌曲。補上編輯功能後才真正跟歌手、歌曲管理的編輯能力一致。
  const [editingId, setEditingId] = useState<string | null>(null);

  function songCountFor(themeId: string) {
    return songs.filter((s) => s.themeIds.includes(themeId)).length;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFormError('請輸入主題名稱');
      return;
    }
    const result = editingId
      ? await songRepository.updateTheme(editingId, { name: trimmed, description: description.trim() })
      : await songRepository.createTheme({ name: trimmed, description: description.trim() });
    if (!result.ok) {
      setFormError(result.error ?? (editingId ? '更新主題失敗' : '新增主題失敗'));
      return;
    }
    onNotice(editingId ? '已更新主題' : '已新增主題');
    setName('');
    setDescription('');
    setEditingId(null);
    onChanged();
  }

  function startEdit(t: Theme) {
    setEditingId(t.id);
    setName(t.name);
    setDescription(t.description ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setName('');
    setDescription('');
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
          {editingId ? '儲存' : '新增'}
        </button>
        {editingId && (
          <button type="button" onClick={cancelEdit} style={editButtonStyle}>
            取消
          </button>
        )}
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
        {themes.map((t) => {
          const count = songCountFor(t.id);
          return (
            <li
              key={t.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                borderRadius: '8px',
                border: editingId === t.id ? '1px solid var(--accent)' : '1px solid var(--groove)',
              }}
            >
              <span>
                {t.name}
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', marginLeft: '8px' }}>
                  {t.description && `${t.description} · `}
                  {count} 首歌
                </span>
              </span>
              <span style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => startEdit(t)} style={editButtonStyle}>
                  編輯
                </button>
                <ConfirmDeleteButton
                  confirmText={
                    count > 0
                      ? `「${t.name}」目前有 ${count} 首歌使用這個主題，刪除後這些歌都會失去這個主題，確定要刪除嗎？`
                      : `確定要刪除主題「${t.name}」嗎？`
                  }
                  onConfirm={async () => {
                    const result = await songRepository.deleteTheme(t.id);
                    if (!result.ok) {
                      onError(result.error ?? '刪除主題失敗');
                      return;
                    }
                    onNotice('已刪除主題');
                    if (editingId === t.id) cancelEdit();
                    onChanged();
                  }}
                />
              </span>
            </li>
          );
        })}
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
  /** 自動判斷主題時模型／規則給的簡短依據，顯示在該列主題下方供管理者核對 */
  themeReason?: string;
  /** 匯入後實際使用的歌名（預設由影片標題推測，可逐列編輯）；title 則保留 YouTube 原始標題供對照 */
  songTitle: string;
  /** 自動推測的歌名，用來判斷管理者是否改過歌名 */
  suggestedTitle: string;
  /** 自動帶入的歌手，用來判斷管理者是否改過歌手 */
  suggestedArtist: string;
  /** 別名（其他也算答對的說法） */
  aliases: string[];
  /** 別名輸入框尚未按下新增的草稿，匯入時會一併納入，避免打了字卻漏按新增 */
  aliasDraft: string;
  // 與題庫的比對結果（見 lib/engine/songMatch.ts）：影片 id、歌名／別名＋歌手相同視為重複，
  // 只有歌名相同則僅提示。歌名或歌手一被編輯就重新比對，結果即時反映在該列。
  match: SongMatch | null;
  /** 這一列是因為偵測到重複而被自動取消勾選的，編輯後不再重複時才會自動勾回 */
  autoDeselected: boolean;
}

function sanitizeAlias(raw: string): string {
  return raw.trim().split(ALIAS_LIST_SEPARATOR).join('；');
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
  artists,
  onImported,
  onNotice,
}: {
  themes: Theme[];
  existingSongs: Song[];
  artists: Artist[];
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
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const themeNameById = new Map(themes.map((t) => [t.id, t.name]));
  const matchIndex = useMemo(() => {
    const artistNameById = new Map(artists.map((a) => [a.id, a.name]));
    return buildSongMatchIndex(
      existingSongs.map((s) => ({
        id: s.id,
        title: s.title,
        aliases: s.aliases,
        artistName: artistNameById.get(s.artistId) ?? '',
        youtubeVideoId: s.youtubeVideoId,
      }))
    );
  }, [existingSongs, artists]);

  /** 依列目前的歌名／歌手重新比對題庫；歌名與歌手都還是自動帶入的值時，額外使用原始標題與頻道名稱佐證 */
  function computeMatch(row: Pick<PlaylistRowState, 'videoId' | 'title' | 'songTitle' | 'suggestedTitle' | 'artistName' | 'suggestedArtist' | 'channelTitle'>): SongMatch | null {
    return findSongMatch(matchIndex, {
      videoId: row.videoId,
      rawTitle: row.title,
      songTitle: row.songTitle,
      artistName: row.artistName,
      channelTitle: row.channelTitle,
      useRaw: row.songTitle === row.suggestedTitle && row.artistName === row.suggestedArtist,
    });
  }

  /** 編輯某一列的歌名／歌手／別名：套用變更後重新比對，重複狀態改變時同步調整勾選 */
  function editRow(idx: number, patch: Partial<PlaylistRowState>) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        if ('songTitle' in patch || 'artistName' in patch) {
          next.match = computeMatch(next);
          const dup = isDuplicateMatch(next.match);
          if (dup && next.selected) {
            next.selected = false;
            next.autoDeselected = true;
          } else if (!dup && next.autoDeselected) {
            next.selected = !next.unavailable && next.embeddable;
            next.autoDeselected = false;
          }
        }
        return next;
      })
    );
  }

  function addRowAlias(idx: number) {
    const row = rows[idx];
    const alias = sanitizeAlias(row.aliasDraft);
    if (!alias) return;
    const exists = [row.songTitle, ...row.aliases].some((a) => a.trim().toLowerCase() === alias.toLowerCase());
    editRow(idx, { aliases: exists ? row.aliases : [...row.aliases, alias], aliasDraft: '' });
  }

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
          const suggestion = suggestSongFields(r.title, artistHintsFor(matchIndex, r.title, r.channelTitle));
          const suggestedArtist = suggestArtistName(matchIndex, r.title, r.channelTitle);
          const base = {
            ...r,
            suggestedArtist,
            songTitle: suggestion.title,
            suggestedTitle: suggestion.title,
            aliases: suggestion.aliases,
            aliasDraft: '',
            artistName: suggestedArtist,
          };
          const match = computeMatch(base);
          const alreadyExists = isDuplicateMatch(match);
          return {
            ...base,
            // 不可用（私人/已刪除）、關閉外部嵌入、或資料庫裡已經有的項目預設不勾選——
            // 已存在的這首歌再匯入一次只會在批次匯入 API 裡被判定成重複而略過，
            // 預先幫管理者把這些排除掉，省去「匯入完才在結果列表裡發現某幾首是重複」
            // 這一輪來回，也不會因為這些已存在的列佔住版面而混淆「真正還沒匯入」的有幾首。
            selected: !r.unavailable && r.embeddable && !alreadyExists,
            themeIds: [],
            match,
            autoDeselected: alreadyExists && !r.unavailable && r.embeddable,
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

  // 自動判斷主題：把已勾選的列（歌名＋歌手）連同既有主題清單送到伺服器，由伺服器查年份／曲風
  // 並請 Claude 從既有主題裡挑選。結果「疊加」到每列目前已勾的主題上（不會清掉管理者手動
  // 勾過的），並附上依據文字；仍然要由管理者檢查後才會真正匯入。
  async function handleAutoSuggest() {
    const targets = rows.filter((r) => r.selected && !r.unavailable);
    if (targets.length === 0 || themes.length === 0) return;
    setSuggesting(true);
    setSuggestNote(null);
    setError(null);
    try {
      // 分批送出（每批 8 首）：每首歌要查年份、維基百科、新聞再交給模型，整批一次送很容易超過
      // Cloudflare Tunnel 約 100 秒的回應上限；分批也讓畫面可以顯示進度，每批結果立即套用到列上。
      const CHUNK = 8;
      const themePayload = themes.map((t) => ({ id: t.id, name: t.name, description: t.description ?? '' }));
      let withTheme = 0;
      let factsFound = 0;
      let evidenceFound = 0;
      let mode: 'ai' | 'rules' = 'ai';
      const warnings = new Set<string>();
      for (let i = 0; i < targets.length; i += CHUNK) {
        setSuggestNote(`判斷中… ${Math.min(i, targets.length)} / ${targets.length}`);
        const chunk = targets.slice(i, i + CHUNK);
        const res = await fetch('/api/themes/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: chunk.map((r) => ({ key: r.videoId, title: r.songTitle.trim() || r.title, artist: r.artistName.trim() || r.channelTitle })),
            themes: themePayload,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? '自動判斷主題失敗');
          break;
        }
        const byKey = new Map<string, { themeIds: string[]; reason: string }>(
          (data.results as { key: string; themeIds: string[]; reason: string }[]).map((r) => [r.key, r])
        );
        withTheme += chunk.filter((r) => (byKey.get(r.videoId)?.themeIds.length ?? 0) > 0).length;
        factsFound += data.factsFound ?? 0;
        evidenceFound += data.evidenceFound ?? 0;
        if (data.mode === 'rules') mode = 'rules';
        for (const w of (data.warnings ?? []) as string[]) warnings.add(w);
        setRows((prev) =>
          prev.map((row) => {
            const hit = byKey.get(row.videoId);
            if (!hit) return row;
            return {
              ...row,
              themeIds: Array.from(new Set([...row.themeIds, ...hit.themeIds])),
              themeReason: hit.themeIds.length > 0 ? hit.reason : hit.reason || '沒有把握，請手動選擇',
            };
          })
        );
      }
      setSuggestNote(
        `${mode === 'ai' ? 'AI' : '規則'}判斷完成：${targets.length} 首中有 ${withTheme} 首找到建議主題（查到年份／曲風 ${factsFound} 首、維基／新聞佐證 ${evidenceFound} 首）。請檢查後再匯入。${warnings.size > 0 ? ' ' + Array.from(warnings).join('；') : ''}`
      );
    } catch {
      setError('自動判斷主題失敗，請檢查網路後再試');
    } finally {
      setSuggesting(false);
    }
  }

  function aliasesForImport(r: PlaylistRowState): string[] {
    const title = (r.songTitle.trim() || r.title).toLowerCase();
    const list = [...r.aliases];
    const draft = sanitizeAlias(r.aliasDraft);
    if (draft) list.push(draft);
    const seen = new Set<string>([title]);
    return list.filter((a) => {
      const k = a.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
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
      // 模式退回固定 30 秒起播（見 lib/engine/modes/randomClipMode.ts 的防呆邏輯），
      // 等於「隨機片段猜歌」對所有用播放清單匯入的歌曲，永遠只會從 0 秒開始播，
      // 完全失去「隨機」這件事——用物件寫法即使之後 SONG_CSV_COLUMNS 的順序調整，
      // 這裡也不會因為數錯位置又重演同一種 bug。
      const csv = Papa.unparse({
        fields: [...SONG_CSV_COLUMNS],
        data: selectedRows.map((r) => {
          const row: Record<(typeof SONG_CSV_COLUMNS)[number], string> = {
            title: r.songTitle.trim() || r.title,
            artist: r.artistName.trim() || '(未知歌手)',
            aliases: aliasesForImport(r).join(ALIAS_LIST_SEPARATOR),
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
      const { created, updated, duplicates, errors, newArtistNames } = result.data.summary;
      // 這裡的歌手名稱是管理者在上面逐列手動輸入/修正的，打錯字、或跟既有歌手名稱有
      // 細微差異（多個空格、簡繁體不同）都會被匯入 API 當成一個全新的歌手建立——
      // 理由、完整說明見 ImportExportBar 裡同一則提示旁的註解。這裡沒有空間放完整的
      // 警示區塊，至少在成功通知裡提醒一句，看到不熟悉的名字就知道該去歌手管理檢查。
      onNotice(
        `播放清單匯入完成：新增 ${created} 首、更新 ${updated} 首${duplicates > 0 ? `、略過重複 ${duplicates} 首` : ''}${errors > 0 ? `、失敗 ${errors} 列` : ''}${newArtistNames.length > 0 ? `（新建立歌手：${newArtistNames.join('、')}，如果是打錯字請到歌手管理修正）` : ''}`
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
                  {rows.some((r) => isDuplicateMatch(r.match)) && `（${rows.filter((r) => isDuplicateMatch(r.match)).length} 首題庫裡已經有了，預設不勾選）`}
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

              {themes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={handleAutoSuggest}
                      disabled={suggesting || selectedCount === 0}
                      style={{ ...buttonStyle, padding: '8px 14px', fontSize: '0.85rem' }}
                    >
                      {suggesting ? '判斷中…' : `自動判斷已勾選 ${selectedCount} 首的主題`}
                    </button>
                    <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem' }}>
                      查年份／曲風，再依既有主題挑選；結果只是建議，下方可逐首修改。
                    </span>
                  </div>
                  {suggestNote && <p style={{ color: 'var(--success)', fontSize: '0.8rem' }}>{suggestNote}</p>}
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
                        aria-label={`選取「${r.songTitle || r.title}」`}
                        onChange={(e) => editRow(idx, { selected: e.target.checked, autoDeselected: false })}
                      />
                      {r.thumbnailUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- 縮圖來自 YouTube 外部網域，非本地靜態資源，不適合用 next/image
                        <img src={r.thumbnailUrl} alt="" width={48} height={36} style={{ borderRadius: '4px', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <input
                            value={r.songTitle}
                            onChange={(e) => editRow(idx, { songTitle: e.target.value })}
                            placeholder="歌名"
                            aria-label="歌名"
                            disabled={r.unavailable}
                            style={{ ...inputStyle, flex: '1 1 180px', minWidth: 0 }}
                          />
                          <input
                            value={r.artistName}
                            onChange={(e) => editRow(idx, { artistName: e.target.value })}
                            placeholder="歌手名稱"
                            aria-label="歌手名稱"
                            disabled={r.unavailable}
                            style={{ ...inputStyle, flex: '0 1 140px', minWidth: 0 }}
                          />
                        </div>
                        {r.unavailable ? (
                          <span style={{ color: 'var(--error)', fontSize: '0.75rem' }}>影片已私人化或刪除，無法匯入</span>
                        ) : !r.embeddable ? (
                          <span style={{ color: 'var(--error)', fontSize: '0.75rem' }}>擁有者關閉外部嵌入播放，遊戲內會無聲</span>
                        ) : r.match && isDuplicateMatch(r.match) ? (
                          <span style={{ color: 'var(--accent)', fontSize: '0.75rem' }}>
                            題庫已有：{r.match.song.artistName}－{r.match.song.title}
                            {r.match.via === 'video' ? '（同一支影片）' : r.match.via === 'alias' ? '（符合別名）' : ''}
                            ，已取消勾選；修改歌名或歌手可重新比對
                          </span>
                        ) : r.match ? (
                          <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem' }}>
                            題庫有同名歌曲（歌手：{r.match.song.artistName}），歌手不同，仍可匯入
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem' }}>{formatDuration(r.durationSec)}</span>
                        )}
                        {r.songTitle !== r.title && (
                          <span
                            title={r.title}
                            style={{ color: 'var(--ink-dim)', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            原標題：{r.title}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 別名管理：與歌名同一區塊，匯入時寫入 aliases（玩家答對歌名或任一別名都算對） */}
                    {!r.unavailable && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', paddingLeft: '26px' }}>
                        <span style={{ color: 'var(--ink-dim)', fontSize: '0.72rem' }}>別名</span>
                        {r.aliases.map((alias) => (
                          <span
                            key={alias}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 4px 2px 10px',
                              borderRadius: '999px',
                              border: '1px solid var(--groove)',
                              fontSize: '0.75rem',
                            }}
                          >
                            {alias}
                            <button
                              type="button"
                              onClick={() => editRow(idx, { aliases: r.aliases.filter((a) => a !== alias) })}
                              aria-label={`移除別名「${alias}」`}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--ink-dim)',
                                cursor: 'pointer',
                                width: '22px',
                                height: '22px',
                                lineHeight: 1,
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          value={r.aliasDraft}
                          onChange={(e) => editRow(idx, { aliasDraft: e.target.value })}
                          onKeyDown={(e) => {
                            // 輸入法選字時的 Enter 不能當成「新增」
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              addRowAlias(idx);
                            }
                          }}
                          placeholder="輸入別名後按 Enter"
                          aria-label={`「${r.songTitle || r.title}」的別名`}
                          style={{ ...inputStyle, width: '150px', padding: '4px 8px', fontSize: '0.78rem' }}
                        />
                        <button
                          type="button"
                          onClick={() => addRowAlias(idx)}
                          disabled={r.aliasDraft.trim().length === 0}
                          style={{ ...editButtonStyle, padding: '4px 10px', fontSize: '0.75rem' }}
                        >
                          新增
                        </button>
                      </div>
                    )}
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
                    {r.themeReason && (
                      <span style={{ paddingLeft: '26px', color: 'var(--ink-dim)', fontSize: '0.72rem' }}>
                        自動判斷：{r.themeReason}
                      </span>
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
                歌名由影片標題推測、歌手名稱預設取自頻道名稱，翻唱／合輯／官方頻道常與實際歌手不同，匯入前請逐一確認或修正；歌名與歌手改動後會重新比對題庫。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}


// ===== 批次比對 Apple Music／Deezer 來源 =====
// 把 scripts/fetch-apple-previews.mjs、scripts/fetch-deezer-previews.mjs 的功能搬進管理頁面：
// 逐首呼叫 /api/songs/match-sources（伺服器端統一節流並查詢外部 API），結果先列出來讓管理者
// 試聽核對，勾選後才寫入——自動比對可能選到翻唱／Live／精選輯版本，不能無人審核就覆蓋。
type MatchPlatform = 'apple' | 'deezer';
type MatchMode = 'fill' | 'refresh';

interface SourceCandidateView {
  trackId: string;
  trackName: string;
  artistName: string;
  previewUrl: string;
  durationSec: number;
}

interface SourceMatchItem {
  key: string;
  songId: string;
  platform: MatchPlatform;
  mode: MatchMode;
  status: 'found' | 'refreshed' | 'notfound' | 'error';
  confidence?: 'high' | 'low';
  candidate?: SourceCandidateView;
  durationDiffSec?: number | null;
  note?: string;
  /** 套用這個候選來源 */
  apply: boolean;
  /** 找不到時：標記「已確認這個平台沒有這首歌」，之後批次比對會略過 */
  markSkip: boolean;
}

const PLATFORM_LABEL: Record<MatchPlatform, string> = { apple: 'Apple Music', deezer: 'Deezer' };
const PLATFORM_INTERVAL_SEC: Record<MatchPlatform, number> = { apple: 3, deezer: 2 };

function SourceMatchAccordion({
  songs,
  artists,
  onChanged,
  onError,
  onNotice,
}: { songs: Song[]; artists: Artist[] } & SectionCallbacks) {
  const [open, setOpen] = useState(false);
  const [platforms, setPlatforms] = useState<Record<MatchPlatform, boolean>>({ apple: true, deezer: true });
  const [mode, setMode] = useState<MatchMode>('fill');
  const [country, setCountry] = useState('TW');
  const [items, setItems] = useState<SourceMatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [applying, setApplying] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const songById = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const artistNameById = useMemo(() => new Map(artists.map((a) => [a.id, a.name])), [artists]);

  /** 依目前模式與勾選的平台，列出需要處理的（歌曲, 平台）組合 */
  const tasks = useMemo(() => {
    const out: { song: Song; platform: MatchPlatform }[] = [];
    for (const song of songs) {
      for (const platform of ['apple', 'deezer'] as MatchPlatform[]) {
        if (!platforms[platform]) continue;
        const url = platform === 'apple' ? song.appleMusicPreviewUrl : song.deezerPreviewUrl;
        const trackId = platform === 'apple' ? song.appleMusicTrackId : song.deezerTrackId;
        const skip = platform === 'apple' ? song.appleMusicSkip : song.deezerSkip;
        if (mode === 'fill' ? !url && !skip : Boolean(url && trackId)) out.push({ song, platform });
      }
    }
    return out;
  }, [songs, platforms, mode]);

  const estimateMin = Math.ceil(
    tasks.reduce((sum, t) => sum + PLATFORM_INTERVAL_SEC[t.platform] * (mode === 'fill' ? 1.5 : 1), 0) / 60
  );

  async function run() {
    if (tasks.length === 0 || running) return;
    cancelRef.current = false;
    setRunning(true);
    setItems([]);
    setPreviewKey(null);
    setProgress({ done: 0, total: tasks.length });
    let done = 0;
    for (const { song, platform } of tasks) {
      if (cancelRef.current) break;
      const key = `${song.id}:${platform}`;
      let item: SourceMatchItem = { key, songId: song.id, platform, mode, status: 'error', apply: false, markSkip: false };
      try {
        const res = await fetch('/api/songs/match-sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform,
            mode,
            title: song.title,
            artist: artistNameById.get(song.artistId) ?? '',
            aliases: song.aliases,
            durationSec: song.durationSec,
            trackId: platform === 'apple' ? song.appleMusicTrackId : song.deezerTrackId,
            country,
          }),
        });
        if (!res.ok) {
          item = { ...item, note: res.status === 401 ? '登入已失效，請重新整理頁面' : `伺服器回應 HTTP ${res.status}` };
        } else {
          const data = await res.json();
          if (data.status === 'found' || data.status === 'refreshed') {
            item = {
              ...item,
              status: data.status,
              confidence: data.confidence,
              candidate: data.candidate,
              durationDiffSec: data.durationDiffSec ?? null,
              note: data.note,
              // 高信心與「用既有 id 刷新」預設勾選；低信心必須管理者試聽後自己勾
              apply: data.status === 'refreshed' || data.confidence === 'high',
            };
          } else if (data.status === 'notfound') {
            item = { ...item, status: 'notfound', note: data.note };
          } else {
            item = { ...item, note: data.error ?? '查詢失敗' };
          }
        }
      } catch {
        item = { ...item, note: '網路錯誤' };
      }
      done += 1;
      setItems((prev) => [...prev, item]);
      setProgress({ done, total: tasks.length });
    }
    setRunning(false);
  }

  function updateItem(key: string, patch: Partial<SourceMatchItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  const applicable = items.filter((it) => (it.apply && it.candidate) || (it.markSkip && it.status === 'notfound'));

  async function applySelected() {
    if (applicable.length === 0) return;
    setApplying(true);
    try {
      const bySong = new Map<string, SourceMatchItem[]>();
      for (const it of applicable) bySong.set(it.songId, [...(bySong.get(it.songId) ?? []), it]);
      let fail = 0;
      const appliedKeys = new Set<string>();
      for (const [songId, group] of bySong) {
        const song = songById.get(songId);
        if (!song) continue;
        const overrides: Partial<Omit<Song, 'id' | 'createdAt'>> = {};
        for (const it of group) {
          if (it.apply && it.candidate) {
            // 重新比對選到的是新來源，舊的「已人工核對」標記不再適用；用 id 刷新則維持原標記
            const keepVerified = it.status === 'refreshed';
            if (it.platform === 'apple') {
              Object.assign(overrides, {
                appleMusicTrackId: it.candidate.trackId,
                appleMusicPreviewUrl: it.candidate.previewUrl,
                appleMusicSkip: false,
                appleMusicVerified: keepVerified ? song.appleMusicVerified : false,
              });
            } else {
              Object.assign(overrides, {
                deezerTrackId: it.candidate.trackId,
                deezerPreviewUrl: it.candidate.previewUrl,
                deezerSkip: false,
                deezerVerified: keepVerified ? song.deezerVerified : false,
              });
            }
          } else if (it.markSkip) {
            Object.assign(overrides, it.platform === 'apple' ? { appleMusicSkip: true } : { deezerSkip: true });
          }
        }
        const result = await songRepository.updateSong(song.id, songToUpdateInput(song, overrides));
        if (result.ok) group.forEach((it) => appliedKeys.add(it.key));
        else fail += 1;
      }
      setItems((prev) => prev.filter((it) => !appliedKeys.has(it.key)));
      if (fail > 0) onError(`有 ${fail} 首歌套用失敗，其餘已成功`);
      else onNotice(`已套用 ${appliedKeys.size} 項來源`);
      onChanged();
    } finally {
      setApplying(false);
    }
  }

  const count = (pred: (it: SourceMatchItem) => boolean) => items.filter(pred).length;

  return (
    <div style={{ border: '1px solid var(--groove)', borderRadius: '10px', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
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
        <span>批次比對 Apple Music／Deezer 來源</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          {open ? '收合' : '展開'}
          <CollapseChevron open={open} />
        </span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--groove)' }}>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', margin: 0 }}>
            自動用歌名＋歌手搜尋試聽來源，結果列出後請試聽核對再套用；不會直接覆蓋。已標記「已確認找不到」的歌曲會略過。
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: '12px', alignItems: 'center' }}>
              <legend style={{ float: 'left', color: 'var(--ink-dim)', fontSize: '0.8rem', marginRight: '8px', padding: 0 }}>平台</legend>
              {(['apple', 'deezer'] as MatchPlatform[]).map((p) => (
                <label key={p} style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={platforms[p]}
                    disabled={running}
                    onChange={(e) => setPlatforms((prev) => ({ ...prev, [p]: e.target.checked }))}
                  />
                  {PLATFORM_LABEL[p]}
                </label>
              ))}
            </fieldset>
            <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: '12px', alignItems: 'center' }}>
              <legend style={{ float: 'left', color: 'var(--ink-dim)', fontSize: '0.8rem', marginRight: '8px', padding: 0 }}>模式</legend>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem' }}>
                <input type="radio" name="match-mode" checked={mode === 'fill'} disabled={running} onChange={() => setMode('fill')} />
                補上缺少的來源
              </label>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem' }}>
                <input type="radio" name="match-mode" checked={mode === 'refresh'} disabled={running} onChange={() => setMode('refresh')} />
                刷新過期網址（用既有 id）
              </label>
            </fieldset>
            {platforms.apple && (
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
                Apple 商店地區
                <select value={country} disabled={running} onChange={(e) => setCountry(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '4px 8px' }}>
                  <option value="TW">TW</option>
                  <option value="US">US</option>
                  <option value="JP">JP</option>
                  <option value="HK">HK</option>
                  <option value="KR">KR</option>
                </select>
              </label>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            {!running ? (
              <button type="button" onClick={run} disabled={tasks.length === 0} style={{ ...buttonStyle, padding: '8px 14px', fontSize: '0.85rem' }}>
                開始比對（{tasks.length} 項）
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                style={editButtonStyle}
              >
                停止（已完成 {progress.done} / {progress.total}）
              </button>
            )}
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.78rem' }}>
              {tasks.length === 0
                ? mode === 'fill'
                  ? '目前沒有需要補來源的歌曲'
                  : '目前沒有可刷新的歌曲（需要已有 track id 與試聽網址）'
                : `預估約 ${Math.max(1, estimateMin)} 分鐘（外部 API 建議每分鐘不超過約 20 次，伺服器已自動控制間隔）`}
            </span>
          </div>

          {(running || progress.total > 0) && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label="比對進度"
              style={{ height: '6px', borderRadius: '999px', background: 'var(--groove)', overflow: 'hidden' }}
            >
              <div
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 200ms ease-out',
                }}
              />
            </div>
          )}

          {items.length > 0 && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
                  高信心／已刷新 {count((i) => i.status === 'refreshed' || i.confidence === 'high')}、低信心 {count((i) => i.confidence === 'low')}、
                  找不到 {count((i) => i.status === 'notfound')}、失敗 {count((i) => i.status === 'error')}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    style={editButtonStyle}
                    onClick={() => setItems((prev) => prev.map((it) => (it.candidate ? { ...it, apply: it.status === 'refreshed' || it.confidence === 'high' } : it)))}
                  >
                    只選高信心
                  </button>
                  <button
                    type="button"
                    style={editButtonStyle}
                    onClick={() => setItems((prev) => prev.map((it) => ({ ...it, apply: false, markSkip: false })))}
                  >
                    全部取消
                  </button>
                </div>
              </div>

              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '460px', overflowY: 'auto', overscrollBehavior: 'contain', padding: 0 }}>
                {items.map((it) => {
                  const song = songById.get(it.songId);
                  if (!song) return null;
                  const label = `${artistNameById.get(song.artistId) ?? '（未知歌手）'}－${song.title}`;
                  return (
                    <li key={it.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--groove)' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {it.candidate ? (
                          <input
                            type="checkbox"
                            checked={it.apply}
                            onChange={(e) => updateItem(it.key, { apply: e.target.checked })}
                            aria-label={`套用 ${PLATFORM_LABEL[it.platform]} 來源：${label}`}
                          />
                        ) : (
                          <span style={{ width: '13px' }} aria-hidden />
                        )}
                        <span style={{ fontSize: '0.85rem' }}>{label}</span>
                        <span style={{ fontSize: '0.7rem', padding: '1px 8px', borderRadius: '999px', border: '1px solid var(--groove)', color: 'var(--ink-dim)' }}>
                          {PLATFORM_LABEL[it.platform]}
                        </span>
                        {it.status === 'refreshed' && <span style={{ fontSize: '0.72rem', color: 'var(--success)' }}>已取得最新網址</span>}
                        {it.confidence === 'high' && <span style={{ fontSize: '0.72rem', color: 'var(--success)' }}>高信心</span>}
                        {it.confidence === 'low' && <span style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>低信心：請試聽確認</span>}
                        {it.status === 'notfound' && <span style={{ fontSize: '0.72rem', color: 'var(--ink-dim)' }}>找不到{it.note ? `（${it.note}）` : ''}</span>}
                        {it.status === 'error' && <span style={{ fontSize: '0.72rem', color: 'var(--error)' }}>失敗：{it.note}</span>}
                      </div>
                      {it.candidate && (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', paddingLeft: '21px', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
                          <span>
                            「{it.candidate.trackName}」－{it.candidate.artistName}
                            {it.candidate.durationSec > 0 && `・${formatDuration(it.candidate.durationSec)}`}
                            {it.note && `・${it.note}`}
                          </span>
                          <button
                            type="button"
                            style={{ ...editButtonStyle, padding: '2px 10px', fontSize: '0.75rem' }}
                            onClick={() => setPreviewKey((k) => (k === it.key ? null : it.key))}
                          >
                            {previewKey === it.key ? '收起試聽' : '試聽'}
                          </button>
                          {previewKey === it.key && <audio controls autoPlay src={it.candidate.previewUrl} style={{ height: '32px' }} />}
                        </div>
                      )}
                      {it.status === 'notfound' && it.mode === 'fill' && (
                        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingLeft: '21px', fontSize: '0.75rem', color: 'var(--ink-dim)' }}>
                          <input type="checkbox" checked={it.markSkip} onChange={(e) => updateItem(it.key, { markSkip: e.target.checked })} />
                          標記為「已確認 {PLATFORM_LABEL[it.platform]} 找不到」，之後批次比對略過這首
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>

              <button
                type="button"
                onClick={applySelected}
                disabled={applying || running || applicable.length === 0}
                style={{ ...buttonStyle, alignSelf: 'flex-start' }}
              >
                {applying ? '套用中…' : `套用所選的 ${applicable.length} 項`}
              </button>
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

      {/* 這次匯入過程中自動建立的新歌手／新主題——CSV 裡歌手或主題名稱如果打錯字、
          跟既有資料對不上，匯入 API 不會讓那一列失敗，而是直接建立一個新的歌手/主題，
          這樣的「意外新增」不會出現在上面的成功/失敗統計裡，容易被忽略，久了同一個
          歌手或主題會累積好幾個名稱相近但不完全一樣的版本。這裡明確列出來，看到眼熟
          卻不完全一樣的名字，就知道該去上面的歌手／主題管理檢查、合併或修正。 */}
      {lastResult && (lastResult.summary.newArtistNames.length > 0 || lastResult.summary.newThemeNames.length > 0) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid var(--accent)',
            background: 'rgba(232, 185, 63, 0.08)',
          }}
        >
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
            這次匯入自動建立了以前沒見過的名稱——如果看到眼熟卻不完全一樣的名字，可能是打字錯誤造成的重複
          </span>
          {lastResult.summary.newArtistNames.length > 0 && (
            <span style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
              新歌手：{lastResult.summary.newArtistNames.join('、')}
            </span>
          )}
          {lastResult.summary.newThemeNames.length > 0 && (
            <span style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
              新主題：{lastResult.summary.newThemeNames.join('、')}
            </span>
          )}
        </div>
      )}

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
  // 歌名文字搜尋——題庫一多（破百首很常見），只靠歌手／主題下拉選單篩選，想找特定一首歌
  // 得先知道它的歌手是誰才能縮小範圍；直接打歌名關鍵字找更直接，兩種篩選方式可以同時用
  // （交集），例如已經篩到某位歌手底下、再用文字搜尋在這位歌手的歌曲裡找特定一首。
  const [titleSearch, setTitleSearch] = useState('');
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
  // 編輯表單在頁面上方、歌曲清單在下面，題庫一長，點了某一列的「編輯」之後表單其實已經
  // 載入好了，但畫面還停在清單那一列，使用者看不到任何變化，會以為按鈕沒反應。
  // 這個錨點放在表單區塊前面，開始編輯時自動捲過去。
  const formAnchorRef = useRef<HTMLDivElement | null>(null);
  const [verifyBusyId, setVerifyBusyId] = useState<string | null>(null);

  function startEditing(song: Song) {
    setEditing(song);
    setTimeout(() => formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  // 單首歌標記／取消單一來源的「已人工核對」，給清單裡邊試聽邊核對用。
  async function setSourceVerified(song: Song, platform: 'apple' | 'deezer', value: boolean) {
    setVerifyBusyId(song.id);
    try {
      const result = await songRepository.updateSong(
        song.id,
        songToUpdateInput(song, platform === 'apple' ? { appleMusicVerified: value } : { deezerVerified: value })
      );
      if (!result.ok) {
        onError(result.error ?? '更新核對標記失敗');
        return;
      }
      onNotice(value ? '已標記為人工核對過' : '已取消核對標記');
      onChanged();
    } finally {
      setVerifyBusyId(null);
    }
  }

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
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('none');
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
        const result = await songRepository.updateSong(song.id, songToUpdateInput(song, { themeIds: mergedThemeIds }));
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

  // 批次刪除——健康檢查篩出「沒有可播放來源」的歌曲，通常不是該補資料修好，而是整筆
  // 資料本身就是廢的（例如播放清單匯入時影片後來被刪除/私人化、或是從來沒成功找到過
  // 任何試聽來源），該刪掉而不是留著佔題庫空間。跟批次套用主題共用同一組「勾選→操作」
  // 的選取狀態（selectedSongIds），差別只在於這是刪除而不是更新，所以另外用
  // ConfirmDeleteButton 包一層確認，不能像套用主題那樣直接按了就送出。
  async function deleteBulkSelected() {
    const targets = songs.filter((s) => selectedSongIds.has(s.id));
    if (targets.length === 0) return;
    setBulkApplying(true);
    try {
      let failCount = 0;
      for (const song of targets) {
        const result = await songRepository.deleteSong(song.id);
        if (!result.ok) failCount++;
      }
      if (failCount > 0) {
        onError(`批次刪除時有 ${failCount} 首失敗，其餘已成功`);
      } else {
        onNotice(`已刪除 ${targets.length} 首歌`);
      }
      setSelectedSongIds(new Set());
      onChanged();
    } finally {
      setBulkApplying(false);
    }
  }

  const songsUnverified = songs.filter((s) => sourceReviewStatus(s) === 'unverified');
  const songsVerified = songs.filter((s) => sourceReviewStatus(s) === 'verified');

  // 批次標記／取消「來源已人工核對」。標記時只動這首歌「實際有的」來源——沒有 Deezer 來源的歌
  // 不會被硬標上 Deezer 已核對；已經是目標狀態的歌曲直接略過、不白白送一次更新請求。
  async function bulkSetVerified(value: boolean) {
    const targets = songs.filter((s) => selectedSongIds.has(s.id));
    if (targets.length === 0) return;
    setBulkApplying(true);
    try {
      let changed = 0;
      let failCount = 0;
      for (const song of targets) {
        const overrides = value
          ? {
              appleMusicVerified: song.appleMusicPreviewUrl ? true : song.appleMusicVerified,
              deezerVerified: song.deezerPreviewUrl ? true : song.deezerVerified,
            }
          : { appleMusicVerified: false, deezerVerified: false };
        if (
          overrides.appleMusicVerified === song.appleMusicVerified &&
          overrides.deezerVerified === song.deezerVerified
        ) {
          continue;
        }
        const result = await songRepository.updateSong(song.id, songToUpdateInput(song, overrides));
        if (result.ok) changed++;
        else failCount++;
      }
      if (failCount > 0) {
        onError(`批次${value ? '標記' : '取消'}核對時有 ${failCount} 首失敗，其餘 ${changed} 首已成功`);
      } else {
        onNotice(
          changed === 0
            ? '所選的歌曲已經都是這個狀態，沒有需要更新的'
            : `已${value ? '標記' : '取消'} ${changed} 首歌的來源核對狀態`
        );
      }
      setSelectedSongIds(new Set());
      onChanged();
    } finally {
      setBulkApplying(false);
    }
  }

  const healthFilterOptions: { key: Exclude<HealthFilter, 'none'>; label: string; count: number }[] = [
    { key: 'no-theme', label: '沒有主題的歌', count: songsWithoutTheme.length },
    { key: 'no-source', label: '沒有可播放來源', count: songsWithoutSource.length },
    { key: 'unverified', label: '來源待核對', count: songsUnverified.length },
    { key: 'verified', label: '來源已核對', count: songsVerified.length },
  ];

  // 歌手／主題查詢可以同時使用（交集），跟比賽建立流程的「擇一」不同——
  // 這裡單純是管理頁面找歌曲用的篩選，不是決定比賽題庫，同時縮小範圍反而更好用。
  // 健康檢查篩選（healthFilter）也是交集疊加上去，不是取代前面兩個篩選——例如可以同時
  // 「依歌手篩選＋只看沒有主題的」，縮小到剛好要處理的那一小批。
  const visibleSongs = songs.filter(
    (s) =>
      (!titleSearch.trim() ||
        s.title.toLowerCase().includes(titleSearch.trim().toLowerCase()) ||
        artistName(s.artistId).toLowerCase().includes(titleSearch.trim().toLowerCase())) &&
      (!filterArtistId || s.artistId === filterArtistId) &&
      (!filterThemeId || s.themeIds.includes(filterThemeId)) &&
      (healthFilter === 'none' ||
        (healthFilter === 'no-theme' && s.themeIds.length === 0) ||
        (healthFilter === 'no-source' && hasNoPlayableSource(s)) ||
        (healthFilter === 'unverified' && sourceReviewStatus(s) === 'unverified') ||
        (healthFilter === 'verified' && sourceReviewStatus(s) === 'verified'))
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

      <div ref={formAnchorRef} style={{ scrollMarginTop: '16px' }} />

      <YouTubeSearchAccordion onPick={setPrefill} />

      <AppleMusicSearchAccordion onPick={setApplePrefill} />

      <DeezerSearchAccordion onPick={setDeezerPrefill} />

      <SourceMatchAccordion songs={songs} artists={artists} onChanged={onChanged} onError={onError} onNotice={onNotice} />

      <YouTubePlaylistImportAccordion themes={themes} existingSongs={songs} artists={artists} onImported={onChanged} onNotice={onNotice} />

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

      <SourceReviewQueue
        songs={songs}
        artistNameOf={artistName}
        onEdit={startEditing}
        onChanged={onChanged}
        onError={onError}
        onNotice={onNotice}
      />

      {songs.length > 8 && (
        <input
          value={titleSearch}
          onChange={(e) => setTitleSearch(e.target.value)}
          placeholder="搜尋歌名或歌手"
          style={inputStyle}
        />
      )}

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
        {(titleSearch.trim() || filterArtistId || filterThemeId) && (
          <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
            {visibleSongs.length} 首
          </span>
        )}
      </div>

      {/* 快速篩選：按鈕上直接標數量，不用點下去才知道有多少筆要處理。數量是 0 的時候
          按鈕停用，不會讓管理者點了一個篩選、結果清單空空如也還要猜是不是沒有問題；
          但「目前正在使用中的篩選」即使數量剛好變成 0 也不能停用——例如在「來源待核對」
          篩選下把最後一首核對完，數量歸零，如果按鈕這時候被鎖住，就沒辦法把篩選關掉了。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>快速篩選：</span>
        {healthFilterOptions.map((opt) => {
          const active = healthFilter === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              disabled={opt.count === 0 && !active}
              onClick={() => setHealthFilter((f) => (f === opt.key ? 'none' : opt.key))}
              style={{
                ...editButtonStyle,
                opacity: opt.count === 0 && !active ? 0.4 : 1,
                borderColor: active ? 'var(--accent)' : 'var(--groove)',
                color: active ? 'var(--accent)' : 'var(--ink)',
              }}
            >
              {opt.label}（{opt.count}）
            </button>
          );
        })}
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

      {/* 批次刪除獨立拆成自己的條件區塊，只靠「有沒有選取歌曲」決定要不要顯示——不像
          批次套用主題那樣額外要求 themes.length > 0。這兩件事本來就無關：刪除不需要
          主題資料存在，如果硬綁在一起，完全沒建立過任何主題的題庫就會連批次刪除都用
          不了，變成「要刪幾首壞掉的歌，得先去建一個用不到的主題」這種不合理的前置條件。 */}
      {selectedSongIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid var(--groove)',
          }}
        >
          <span style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>已選 {selectedSongIds.size} 首</span>
          {/* 「先篩出來源待核對→全選→聽過一輪抽查沒問題→一次標記」這條路徑用的：標記核對是
              一個有份量的宣告（代表人工確認過是正確版本），所以跟刪除一樣先確認一次。 */}
          <ConfirmActionButton
            label="標記來源為已核對"
            confirmText={`確定這 ${selectedSongIds.size} 首歌的 Apple Music／Deezer 來源都人工核對過、是正確版本嗎？`}
            confirmLabel="確定標記"
            disabled={bulkApplying}
            onConfirm={() => bulkSetVerified(true)}
          />
          <button type="button" disabled={bulkApplying} onClick={() => bulkSetVerified(false)} style={editButtonStyle}>
            取消核對標記
          </button>
          <span style={{ width: '1px', height: '20px', background: 'var(--groove)' }} />
          <ConfirmDeleteButton
            confirmText={`確定要刪除所選的 ${selectedSongIds.size} 首歌嗎？這個動作無法復原。`}
            onConfirm={deleteBulkSelected}
          />
        </div>
      )}

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
                  <span
                    style={{ position: 'relative', width: '16px', textAlign: 'center' }}
                    title={s.appleMusicPreviewUrl ? `Apple Music（${s.appleMusicVerified ? '已人工核對' : '尚未核對'}）` : 'Apple Music'}
                  >
                    {s.appleMusicPreviewUrl ? '🍎' : ''}
                    {s.appleMusicPreviewUrl && s.appleMusicVerified && <VerifiedTick />}
                  </span>
                  <span style={{ color: 'var(--groove)' }}>|</span>
                  <span
                    style={{ position: 'relative', width: '16px', textAlign: 'center' }}
                    title={s.deezerPreviewUrl ? `Deezer（${s.deezerVerified ? '已人工核對' : '尚未核對'}）` : 'Deezer'}
                  >
                    {s.deezerPreviewUrl ? '🎵' : ''}
                    {s.deezerPreviewUrl && s.deezerVerified && <VerifiedTick />}
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
                <button onClick={() => startEditing(s)} style={editButtonStyle}>
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
                {sourceReviewStatus(s) === 'unverified' && <span style={{ color: 'var(--accent)' }}> · 來源待核對</span>}
                {sourceReviewStatus(s) === 'verified' && <span style={{ color: 'var(--success)' }}> · ✓ 來源已核對</span>}
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
            {previewSongId === s.id && <SongPreviewPlayer song={s} source={resolvePreviewSource(s, previewSource)} />}
            {/* 邊聽邊核對：就在播放器下面，不用聽完還要點編輯、捲到表單最下面找勾選框。
                各平台各自一顆按鈕，狀態跟著標籤走（已核對時綠色，再點一次取消）。 */}
            {previewSongId === s.id && (s.appleMusicPreviewUrl || s.deezerPreviewUrl) && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.78rem' }}>聽完覺得是正確版本？</span>
                {s.appleMusicPreviewUrl && (
                  <button
                    type="button"
                    disabled={verifyBusyId === s.id}
                    onClick={() => setSourceVerified(s, 'apple', !s.appleMusicVerified)}
                    style={{
                      ...editButtonStyle,
                      borderColor: s.appleMusicVerified ? 'var(--success)' : 'var(--groove)',
                      color: s.appleMusicVerified ? 'var(--success)' : 'var(--ink)',
                    }}
                  >
                    {s.appleMusicVerified ? '✓ Apple Music 已核對（點此取消）' : '標記 Apple Music 來源為正確'}
                  </button>
                )}
                {s.deezerPreviewUrl && (
                  <button
                    type="button"
                    disabled={verifyBusyId === s.id}
                    onClick={() => setSourceVerified(s, 'deezer', !s.deezerVerified)}
                    style={{
                      ...editButtonStyle,
                      borderColor: s.deezerVerified ? 'var(--success)' : 'var(--groove)',
                      color: s.deezerVerified ? 'var(--success)' : 'var(--ink)',
                    }}
                  >
                    {s.deezerVerified ? '✓ Deezer 已核對（點此取消）' : '標記 Deezer 來源為正確'}
                  </button>
                )}
              </div>
            )}
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
  // 自動判斷主題（與播放清單匯入共用 /api/themes/suggest）：結果「疊加」到已勾選的主題上，
  // 不會取消管理者手動勾過的，說明文字顯示依據，仍需管理者確認後才送出表單。
  const [suggestingThemes, setSuggestingThemes] = useState(false);
  const [themeSuggestNote, setThemeSuggestNote] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  // Apple/Deezer 的 track id 純粹是給批次腳本重新查詢核對用，日常編輯很少需要看到，
  // 預設收起來，表單不會一次塞滿太多欄位；已經有值的話（例如舊資料本來就填過）預設展開，
  // 避免管理者以為那筆資料不見了。
  const [showAdvancedSourceFields, setShowAdvancedSourceFields] = useState(
    Boolean(editing?.appleMusicTrackId || editing?.deezerTrackId)
  );
  // 表單自己的驗證/送出錯誤，顯示在送出按鈕旁邊，而不是丟到頁面最上方（太容易被忽略）
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSuggestThemes() {
    const title = form.title.trim();
    const artist =
      form.artistId === NEW_ARTIST_OPTION ? newArtistName.trim() : (artists.find((a) => a.id === form.artistId)?.name ?? '');
    if (!title || !artist) {
      setThemeSuggestNote({ text: '請先填寫歌名並選擇歌手，再自動判斷主題', tone: 'warn' });
      return;
    }
    setSuggestingThemes(true);
    setThemeSuggestNote(null);
    try {
      const res = await fetch('/api/themes/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ key: 'form', title, artist }],
          themes: themes.map((t) => ({ id: t.id, name: t.name, description: t.description ?? '' })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setThemeSuggestNote({ text: data.error ?? '自動判斷主題失敗', tone: 'warn' });
        return;
      }
      const hit = (data.results as { key: string; themeIds: string[]; reason: string }[]).find((r) => r.key === 'form');
      const warnings: string[] = data.warnings ?? [];
      const suffix = warnings.length > 0 ? `（${warnings.join('；')}）` : '';
      if (!hit || hit.themeIds.length === 0) {
        setThemeSuggestNote({ text: `沒有把握，請手動選擇${suffix}`, tone: 'warn' });
        return;
      }
      const added = hit.themeIds.filter((id) => !form.themeIds.includes(id));
      setForm((f) => ({ ...f, themeIds: Array.from(new Set([...f.themeIds, ...hit.themeIds])) }));
      const names = hit.themeIds.map((id) => themes.find((t) => t.id === id)?.name).filter(Boolean).join('、');
      setThemeSuggestNote({
        text: `${data.mode === 'ai' ? 'AI' : '規則'}建議：${names}${hit.reason ? `（${hit.reason}）` : ''}${added.length === 0 ? '，皆已勾選' : ''}${suffix}`,
        tone: 'ok',
      });
    } catch {
      setThemeSuggestNote({ text: '自動判斷主題失敗，請檢查網路後再試', tone: 'warn' });
    } finally {
      setSuggestingThemes(false);
    }
  }

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>主題（可複選，選填）</span>
            <button
              type="button"
              onClick={handleSuggestThemes}
              disabled={suggestingThemes}
              style={{ ...editButtonStyle, padding: '4px 12px', fontSize: '0.78rem' }}
            >
              {suggestingThemes ? '判斷中…' : '自動判斷主題'}
            </button>
          </div>
          <div aria-live="polite">
            {themeSuggestNote && (
              <p style={{ margin: 0, fontSize: '0.78rem', color: themeSuggestNote.tone === 'ok' ? 'var(--success)' : 'var(--ink-dim)' }}>
                {themeSuggestNote.text}
              </p>
            )}
          </div>
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
          已人工核對過，這個 Apple Music 來源就是正確版本（之後批次腳本若需要重新搜尋比對，會跳過這首歌，不會被覆蓋）
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
          已人工核對過，這個 Deezer 來源就是正確版本（之後批次腳本若需要重新搜尋比對，會跳過這首歌，不會被覆蓋）
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
