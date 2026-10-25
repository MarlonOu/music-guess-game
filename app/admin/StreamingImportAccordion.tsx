'use client';

import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import type { Song } from '../../lib/types/song';
import type { Artist, Theme } from '../../lib/types/theme';
import { songRepository } from '../../lib/repository/songRepository';
import { SONG_CSV_COLUMNS, ALIAS_LIST_SEPARATOR } from '../../lib/csv/songCsv';
import { buildSongMatchIndex, findSongMatch, isDuplicateMatch, suggestSongFields, type SongMatch } from '../../lib/engine/songMatch';
import { PLATFORM_LABEL, type MatchPlatform, type SourceCandidateView } from './ManualSourceSearch';
import { SourceSearchPanel, type SearchPlatform, type YoutubeCandidate } from './SourceSearchPanel';
import { buttonStyle, editButtonStyle, formatDuration, inputStyle } from './adminShared';

// ===== 從串流平台（KKBOX／Spotify）歌單匯入 =====
// 歌單只提供「歌名＋歌手」，沒有可播放的來源，所以每首歌都要另外指定來源（YouTube／Apple Music／Deezer 至少一個）
// 才能匯入：可用「自動比對」逐首查 Apple／Deezer，也可以用搜尋面板（radio 切換平台）手動搜尋並關連。
// 寫入沿用 CSV 匯入 API，與 YouTube 播放清單匯入共用同一套寫入與去重邏輯。

type StreamingPlatform = 'kkbox' | 'spotify';
const STREAMING_LABEL: Record<StreamingPlatform, string> = { kkbox: 'KKBOX', spotify: 'Spotify' };
const URL_PLACEHOLDER: Record<StreamingPlatform, string> = {
  kkbox: '貼上 KKBOX 歌單網址，例如 https://www.kkbox.com/tw/tc/playlist/…',
  spotify: '貼上 Spotify 歌單網址，例如 https://open.spotify.com/playlist/…',
};
const MATCH_PLATFORMS: MatchPlatform[] = ['apple', 'deezer'];

interface StreamingTrack {
  title: string;
  artist: string;
  artistsAll: string;
  coverUrl: string;
}

interface SourceState {
  status: 'idle' | 'found' | 'notfound' | 'error';
  confidence?: 'high' | 'low';
  candidate?: SourceCandidateView;
  note?: string;
  apply: boolean;
  manual?: boolean;
  markSkip: boolean;
  loading?: boolean;
}

const IDLE_SOURCE: SourceState = { status: 'idle', apply: false, markSkip: false };

interface Row {
  id: string;
  track: StreamingTrack;
  selected: boolean;
  songTitle: string;
  artistName: string;
  suggestedTitle: string;
  suggestedArtist: string;
  aliases: string[];
  aliasDraft: string;
  themeIds: string[];
  themeReason?: string;
  match: SongMatch | null;
  autoDeselected: boolean;
  youtube: YoutubeCandidate | null;
  apple: SourceState;
  deezer: SourceState;
}

function sanitizeAlias(raw: string): string {
  return raw.trim().split(ALIAS_LIST_SEPARATOR).join('；');
}

const smallText: React.CSSProperties = { color: 'var(--ink-dim)', fontSize: '0.75rem' };
const pillStyle: React.CSSProperties = { fontSize: '0.72rem', padding: '1px 8px', borderRadius: '999px', border: '1px solid var(--groove)', color: 'var(--ink-dim)' };
const miniButton: React.CSSProperties = { ...editButtonStyle, padding: '2px 10px', fontSize: '0.75rem', minHeight: '32px' };

function appliedSource(s: SourceState): SourceCandidateView | null {
  return s.apply && s.candidate ? s.candidate : null;
}

/** 歌曲長度：依序取 YouTube、Apple、Deezer 已指定來源的長度，都沒有則為 0 */
function knownDuration(r: Row): number {
  const yt = r.youtube && r.youtube.embeddable ? r.youtube.durationSec : 0;
  return yt || appliedSource(r.apple)?.durationSec || appliedSource(r.deezer)?.durationSec || 0;
}

function hasSource(r: Row): boolean {
  return Boolean((r.youtube && r.youtube.embeddable) || appliedSource(r.apple) || appliedSource(r.deezer));
}

/** 這一列能不能匯入：沒有重複、至少指定一個來源、且能得到歌曲長度 */
function importBlocker(r: Row): string | null {
  if (isDuplicateMatch(r.match)) return '題庫已有這首歌';
  if (!hasSource(r)) return '尚未指定任何來源（YouTube／Apple／Deezer）';
  if (knownDuration(r) <= 0) return '來源缺少歌曲長度，請改選其他來源';
  return null;
}

export function StreamingImportAccordion({
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
  const [platform, setPlatform] = useState<StreamingPlatform>('kkbox');
  const [url, setUrl] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [playlistName, setPlaylistName] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickApplyThemeIds, setQuickApplyThemeIds] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState({ done: 0, total: 0 });
  const [country, setCountry] = useState('TW');
  const [searchState, setSearchState] = useState<{ rowId: string; platform: SearchPlatform } | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const idSeq = useRef(0);
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

  function computeMatch(songTitle: string, artistName: string): SongMatch | null {
    return findSongMatch(matchIndex, { videoId: '', rawTitle: songTitle, songTitle, artistName, channelTitle: artistName, useRaw: false });
  }

  // ---- 讀取歌單 ----
  async function handleFetch() {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setRows([]);
    setSearchState(null);
    setSuggestNote(null);
    try {
      const res = await fetch(`/api/streaming-playlist?platform=${platform}&url=${encodeURIComponent(url.trim())}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `讀取歌單失敗（HTTP ${res.status}）`);
        return;
      }
      const tracks: StreamingTrack[] = Array.isArray(data.tracks) ? data.tracks : [];
      if (tracks.length === 0) {
        setError('這個歌單裡沒有讀到任何歌曲');
        return;
      }
      setPlaylistName(typeof data.name === 'string' ? data.name : '');
      setTruncated(Boolean(data.truncated));
      setRows(
        tracks.map((track) => {
          const suggestion = suggestSongFields(track.title, [track.artist]);
          const aliases = suggestion.aliases.filter((a) => a.trim().toLowerCase() !== suggestion.title.trim().toLowerCase());
          const match = computeMatch(suggestion.title, track.artist);
          const dup = isDuplicateMatch(match);
          return {
            id: `r${++idSeq.current}`,
            track,
            songTitle: suggestion.title,
            artistName: track.artist,
            suggestedTitle: suggestion.title,
            suggestedArtist: track.artist,
            aliases,
            aliasDraft: '',
            themeIds: [],
            match,
            selected: !dup,
            autoDeselected: dup,
            youtube: null,
            apple: IDLE_SOURCE,
            deezer: IDLE_SOURCE,
          };
        })
      );
    } catch {
      setError('網路錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  // ---- 列編輯 ----
  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if ('songTitle' in patch || 'artistName' in patch) {
          next.match = computeMatch(next.songTitle, next.artistName);
          const dup = isDuplicateMatch(next.match);
          if (dup && next.selected) {
            next.selected = false;
            next.autoDeselected = true;
          } else if (!dup && next.autoDeselected) {
            next.selected = true;
            next.autoDeselected = false;
          }
        }
        return next;
      })
    );
  }

  function updateSource(id: string, p: MatchPlatform, patch: Partial<SourceState>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [p]: { ...row[p], ...patch } } : row)));
  }

  function addAlias(row: Row) {
    const alias = sanitizeAlias(row.aliasDraft);
    if (!alias) return;
    const exists = [row.songTitle, ...row.aliases].some((a) => a.trim().toLowerCase() === alias.toLowerCase());
    updateRow(row.id, { aliases: exists ? row.aliases : [...row.aliases, alias], aliasDraft: '' });
  }

  function toggleTheme(row: Row, themeId: string) {
    const has = row.themeIds.includes(themeId);
    updateRow(row.id, { themeIds: has ? row.themeIds.filter((t) => t !== themeId) : [...row.themeIds, themeId] });
  }

  function toggleAll(selected: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, selected: selected && !isDuplicateMatch(r.match), autoDeselected: false })));
  }

  function applyThemesToSelected() {
    if (quickApplyThemeIds.length === 0) return;
    setRows((prev) => prev.map((r) => (r.selected ? { ...r, themeIds: [...quickApplyThemeIds] } : r)));
  }

  const selectedRows = rows.filter((r) => r.selected);
  const importable = rows.filter((r) => r.selected && importBlocker(r) === null);
  const anyBusy = importing || matching || suggesting;

  // ---- 自動判斷主題（每批 8 首，結果疊加並附依據）----
  async function handleAutoSuggest() {
    const targets = rows.filter((r) => r.selected);
    if (targets.length === 0 || themes.length === 0) return;
    setSuggesting(true);
    setSuggestNote(null);
    setError(null);
    try {
      const CHUNK = 8;
      const themePayload = themes.map((t) => ({ id: t.id, name: t.name, description: t.description ?? '' }));
      let withTheme = 0;
      let mode: 'ai' | 'rules' = 'ai';
      const warnings = new Set<string>();
      for (let i = 0; i < targets.length; i += CHUNK) {
        setSuggestNote(`判斷中… ${Math.min(i, targets.length)} / ${targets.length}`);
        const chunk = targets.slice(i, i + CHUNK);
        const res = await fetch('/api/themes/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: chunk.map((r) => ({ key: r.id, title: r.songTitle.trim() || r.track.title, artist: r.artistName.trim() })), themes: themePayload }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? '自動判斷主題失敗');
          break;
        }
        const byKey = new Map<string, { themeIds: string[]; reason: string }>(
          (data.results as { key: string; themeIds: string[]; reason: string }[]).map((r) => [r.key, r])
        );
        withTheme += chunk.filter((r) => (byKey.get(r.id)?.themeIds.length ?? 0) > 0).length;
        if (data.mode === 'rules') mode = 'rules';
        for (const w of (data.warnings ?? []) as string[]) warnings.add(w);
        setRows((prev) =>
          prev.map((row) => {
            const hit = byKey.get(row.id);
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
        `${mode === 'ai' ? 'AI' : '規則'}判斷完成：${targets.length} 首中有 ${withTheme} 首找到建議主題。請檢查後再匯入。${warnings.size > 0 ? ' ' + Array.from(warnings).join('；') : ''}`
      );
    } catch {
      setError('自動判斷主題失敗，請檢查網路後再試');
    } finally {
      setSuggesting(false);
    }
  }

  // ---- Apple／Deezer 自動比對（逐首、逐平台依序，伺服器端統一節流）----
  async function matchOne(row: Row, p: MatchPlatform): Promise<void> {
    updateSource(row.id, p, { loading: true });
    let next: SourceState = { ...IDLE_SOURCE, status: 'error' };
    try {
      const res = await fetch('/api/songs/match-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: p,
          mode: 'fill',
          title: row.songTitle.trim() || row.track.title,
          artist: row.artistName.trim(),
          aliases: row.aliases,
          durationSec: knownDuration(row) || null,
          country,
        }),
      });
      if (!res.ok) {
        next = { ...next, note: res.status === 401 ? '登入已失效，請重新整理頁面' : `伺服器回應 HTTP ${res.status}` };
      } else {
        const data = await res.json();
        if (data.status === 'found') {
          next = { status: 'found', confidence: data.confidence, candidate: data.candidate, note: data.note, apply: data.confidence === 'high', markSkip: false };
        } else if (data.status === 'notfound') {
          next = { ...IDLE_SOURCE, status: 'notfound', note: data.note };
        } else {
          next = { ...next, note: data.error ?? '查詢失敗' };
        }
      }
    } catch {
      next = { ...next, note: '網路錯誤' };
    }
    updateSource(row.id, p, { ...next, loading: false });
  }

  async function runMatching(targets: Row[], only: MatchPlatform[] = MATCH_PLATFORMS) {
    if (targets.length === 0 || matching) return;
    cancelRef.current = false;
    setMatching(true);
    const total = targets.length * only.length;
    setMatchProgress({ done: 0, total });
    let done = 0;
    for (const row of targets) {
      for (const p of only) {
        if (cancelRef.current) break;
        await matchOne(row, p);
        done += 1;
        setMatchProgress({ done, total });
      }
      if (cancelRef.current) break;
    }
    setMatching(false);
  }

  // ---- 手動指定來源 ----
  function pickCandidate(id: string, p: MatchPlatform, candidate: SourceCandidateView) {
    updateSource(id, p, { status: 'found', confidence: undefined, candidate, note: undefined, manual: true, apply: true, markSkip: false });
    setPreviewKey(null);
  }

  function pickYoutube(id: string, candidate: YoutubeCandidate) {
    updateRow(id, { youtube: candidate });
  }

  // ---- 匯入 ----
  function aliasesForImport(r: Row): string[] {
    const title = (r.songTitle.trim() || r.track.title).toLowerCase();
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

  function csvSource(s: SourceState): { id: string; url: string; skip: string; verified: string } {
    if (s.apply && s.candidate) return { id: s.candidate.trackId, url: s.candidate.previewUrl, skip: '', verified: 'true' };
    if (s.status === 'notfound' && s.markSkip) return { id: '', url: '', skip: 'true', verified: '' };
    return { id: '', url: '', skip: '', verified: '' };
  }

  async function handleImport() {
    if (importable.length === 0 || importing) return;
    setImporting(true);
    setError(null);
    try {
      const csv = Papa.unparse({
        fields: [...SONG_CSV_COLUMNS],
        data: importable.map((r) => {
          const apple = csvSource(r.apple);
          const deezer = csvSource(r.deezer);
          const row: Record<(typeof SONG_CSV_COLUMNS)[number], string> = {
            title: r.songTitle.trim() || r.track.title,
            artist: r.artistName.trim() || '(未知歌手)',
            aliases: aliasesForImport(r).join(ALIAS_LIST_SEPARATOR),
            youtubeVideoId: r.youtube && r.youtube.embeddable ? r.youtube.videoId : '',
            appleMusicTrackId: apple.id,
            appleMusicPreviewUrl: apple.url,
            appleMusicSkip: apple.skip,
            appleMusicVerified: apple.verified,
            deezerTrackId: deezer.id,
            deezerPreviewUrl: deezer.url,
            deezerSkip: deezer.skip,
            deezerVerified: deezer.verified,
            durationSec: String(knownDuration(r)),
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
      onNotice(
        `${STREAMING_LABEL[platform]} 歌單匯入完成：新增 ${created} 首、更新 ${updated} 首${duplicates > 0 ? `、略過重複 ${duplicates} 首` : ''}${errors > 0 ? `、失敗 ${errors} 列` : ''}${newArtistNames.length > 0 ? `（新建立歌手：${newArtistNames.join('、')}，如果是打錯字請到歌手管理修正）` : ''}`
      );
      onImported();
      // 保留未匯入的列（失敗或尚未選取），已匯入的移除
      const importedIds = new Set(importable.map((r) => r.id));
      setRows((prev) => prev.filter((r) => !importedIds.has(r.id)));
      setSearchState(null);
    } finally {
      setImporting(false);
    }
  }

  // ---- 畫面 ----
  function renderSourceLine(row: Row, p: SearchPlatform) {
    const open = searchState?.rowId === row.id && searchState.platform === p;
    const toggle = () => setSearchState(open ? null : { rowId: row.id, platform: p });

    if (p === 'youtube') {
      const yt = row.youtube;
      return (
        <div key={p} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={pillStyle}>YouTube</span>
          {yt ? (
            <span style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', overflowWrap: 'anywhere', flex: '1 1 160px', minWidth: 0 }}>
              {yt.title}・{yt.channelTitle}
              {yt.durationSec > 0 && `・${formatDuration(yt.durationSec)}`}
            </span>
          ) : (
            <span style={smallText}>尚未指定</span>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
            {yt && (
              <button type="button" onClick={() => updateRow(row.id, { youtube: null })} style={miniButton}>
                移除
              </button>
            )}
            <button type="button" aria-expanded={open} onClick={toggle} style={miniButton}>
              {open ? '收起搜尋' : '搜尋來源'}
            </button>
          </span>
        </div>
      );
    }

    const s = row[p];
    const key = `${row.id}:${p}`;
    const label = `${row.artistName}－${row.songTitle}`;
    return (
      <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {s.candidate ? (
            <input
              type="checkbox"
              checked={s.apply}
              onChange={(e) => updateSource(row.id, p, { apply: e.target.checked })}
              aria-label={`套用 ${PLATFORM_LABEL[p]} 來源：${label}`}
              style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
            />
          ) : null}
          <span style={pillStyle}>{PLATFORM_LABEL[p]}</span>
          {s.loading && <span style={smallText}>比對中…</span>}
          {!s.loading && s.status === 'idle' && <span style={smallText}>尚未指定</span>}
          {s.manual && <span style={{ fontSize: '0.72rem', color: 'var(--success)' }}>手動指定</span>}
          {s.confidence === 'high' && <span style={{ fontSize: '0.72rem', color: 'var(--success)' }}>高信心</span>}
          {s.confidence === 'low' && <span style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>低信心：請試聽確認</span>}
          {s.status === 'notfound' && <span style={smallText}>找不到{s.note ? `（${s.note}）` : ''}</span>}
          {s.status === 'error' && <span style={{ fontSize: '0.72rem', color: 'var(--error)' }}>失敗：{s.note}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
            <button type="button" disabled={matching || s.loading} onClick={() => runMatching([row], [p])} style={miniButton}>
              {s.status === 'idle' ? '自動比對' : '重新比對'}
            </button>
            <button type="button" aria-expanded={open} onClick={toggle} style={miniButton}>
              {open ? '收起搜尋' : '搜尋來源'}
            </button>
          </span>
        </div>
        {s.candidate && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', paddingLeft: '24px', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
            <span>
              「{s.candidate.trackName}」－{s.candidate.artistName}
              {s.candidate.durationSec > 0 && `・${formatDuration(s.candidate.durationSec)}`}
              {s.note && `・${s.note}`}
            </span>
            <button type="button" style={miniButton} onClick={() => setPreviewKey((k) => (k === key ? null : key))}>
              {previewKey === key ? '收起試聽' : '試聽'}
            </button>
            {previewKey === key && <audio controls autoPlay src={s.candidate.previewUrl} style={{ height: '32px', maxWidth: '100%' }} />}
          </div>
        )}
        {s.status === 'notfound' && (
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingLeft: '24px', ...smallText }}>
            <input type="checkbox" checked={s.markSkip} onChange={(e) => updateSource(row.id, p, { markSkip: e.target.checked })} />
            標記為「已確認 {PLATFORM_LABEL[p]} 找不到」，之後批次比對略過這首
          </label>
        )}
      </div>
    );
  }

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
          minHeight: '44px',
        }}
      >
        <span>從 KKBOX／Spotify 歌單批次匯入</span>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>{open ? '收合' : '展開'}</span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--groove)' }}>
          <p style={{ ...smallText, margin: 0 }}>
            讀取歌單的歌名與歌手後，逐首核對、判斷主題，並為每首指定來源（YouTube／Apple Music／Deezer 至少一個）才能匯入。
          </p>

          <div role="radiogroup" aria-label="歌單平台" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(Object.keys(STREAMING_LABEL) as StreamingPlatform[]).map((p) => {
              const checked = platform === p;
              return (
                <label
                  key={p}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    minHeight: '44px',
                    padding: '0 14px',
                    borderRadius: '999px',
                    border: `1px solid ${checked ? 'var(--accent)' : 'var(--groove)'}`,
                    color: checked ? 'var(--accent)' : 'var(--ink-dim)',
                    background: checked ? 'var(--bg)' : 'transparent',
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                  }}
                >
                  <input type="radio" name="streaming-platform" value={p} checked={checked} onChange={() => setPlatform(p)} style={{ accentColor: 'var(--accent)' }} />
                  {STREAMING_LABEL[p]}
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleFetch();
                }
              }}
              aria-label={`${STREAMING_LABEL[platform]} 歌單網址`}
              placeholder={URL_PLACEHOLDER[platform]}
              style={{ ...inputStyle, flex: '1 1 260px', minWidth: 0 }}
            />
            <button type="button" onClick={handleFetch} disabled={loading || !url.trim()} style={{ ...editButtonStyle, minHeight: '44px' }}>
              {loading ? '讀取中…' : '讀取歌單'}
            </button>
          </div>
          {platform === 'spotify' && <p style={{ ...smallText, margin: 0 }}>Spotify 歌單需為公開歌單，單次最多讀取約 100 首。</p>}
          {error && (
            <p role="alert" style={{ color: 'var(--error)', fontSize: '0.85rem', margin: 0 }}>
              {error}
            </p>
          )}

          {rows.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
                  {playlistName && `「${playlistName}」・`}共 {rows.length} 首，已選 {selectedRows.length} 首
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
              {truncated && <p style={{ ...smallText, margin: 0 }}>歌單曲數超過一次能讀取的上限，只載入了前面一部分，其餘需要分次匯入。</p>}

              {themes.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>快速套用主題到已勾選的列：</span>
                  {themes.map((t) => {
                    const checked = quickApplyThemeIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '999px', border: '1px solid var(--groove)', background: checked ? 'var(--bg-raised)' : 'transparent', fontSize: '0.8rem' }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => setQuickApplyThemeIds((prev) => (checked ? prev.filter((id) => id !== t.id) : [...prev, t.id]))} />
                        {t.name}
                      </label>
                    );
                  })}
                  <button type="button" onClick={applyThemesToSelected} disabled={quickApplyThemeIds.length === 0} style={editButtonStyle}>
                    套用到已勾選的 {selectedRows.length} 首
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  {themes.length > 0 && (
                    <button type="button" onClick={handleAutoSuggest} disabled={anyBusy || selectedRows.length === 0} style={{ ...buttonStyle, padding: '8px 14px', fontSize: '0.85rem' }}>
                      {suggesting ? '判斷中…' : `自動判斷已勾選 ${selectedRows.length} 首的主題`}
                    </button>
                  )}
                  {!matching ? (
                    <button type="button" onClick={() => runMatching(selectedRows)} disabled={anyBusy || selectedRows.length === 0} style={{ ...buttonStyle, padding: '8px 14px', fontSize: '0.85rem' }}>
                      {`自動比對已勾選 ${selectedRows.length} 首的 Apple／Deezer 來源`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        cancelRef.current = true;
                      }}
                      style={editButtonStyle}
                    >
                      停止（已完成 {matchProgress.done} / {matchProgress.total}）
                    </button>
                  )}
                  <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                    Apple 商店地區
                    <select value={country} disabled={matching} onChange={(e) => setCountry(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '4px 8px' }}>
                      {['TW', 'US', 'JP', 'HK', 'KR'].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <span style={smallText}>YouTube 來源請用各列的「搜尋來源」手動指定（YouTube 搜尋有配額限制，不提供批次自動搜尋）。</span>
                {matching && (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={matchProgress.total}
                    aria-valuenow={matchProgress.done}
                    aria-label="來源比對進度"
                    style={{ height: '6px', borderRadius: '999px', background: 'var(--groove)', overflow: 'hidden' }}
                  >
                    <div style={{ width: `${matchProgress.total ? (matchProgress.done / matchProgress.total) * 100 : 0}%`, height: '100%', background: 'var(--accent)', transition: 'width 200ms ease-out' }} />
                  </div>
                )}
                {suggestNote && <p style={{ color: 'var(--success)', fontSize: '0.8rem', margin: 0 }}>{suggestNote}</p>}
              </div>

              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '720px', overflowY: 'auto', overscrollBehavior: 'contain' }}>
                {rows.map((r) => {
                  const dup = isDuplicateMatch(r.match);
                  const blocker = importBlocker(r);
                  const searchOpen = searchState?.rowId === r.id;
                  return (
                    <li key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--groove)' }}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={(e) => updateRow(r.id, { selected: e.target.checked, autoDeselected: false })}
                          aria-label={`選取「${r.songTitle || r.track.title}」`}
                          style={{ width: '18px', height: '18px', marginTop: '10px', accentColor: 'var(--accent)' }}
                        />
                        {r.track.coverUrl && (
                          // eslint-disable-next-line @next/next/no-img-element -- 封面來自 KKBOX 外部網域
                          <img src={r.track.coverUrl} alt="" width={40} height={40} loading="lazy" style={{ borderRadius: '4px', flexShrink: 0, background: 'var(--groove)' }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <input
                              value={r.songTitle}
                              onChange={(e) => updateRow(r.id, { songTitle: e.target.value })}
                              placeholder="歌名"
                              aria-label="歌名"
                              style={{ ...inputStyle, flex: '1 1 180px', minWidth: 0 }}
                            />
                            <input
                              value={r.artistName}
                              onChange={(e) => updateRow(r.id, { artistName: e.target.value })}
                              placeholder="歌手名稱"
                              aria-label="歌手名稱"
                              style={{ ...inputStyle, flex: '0 1 150px', minWidth: 0 }}
                            />
                          </div>
                          {r.track.artistsAll && <span style={smallText}>{STREAMING_LABEL[platform]} 歌手：{r.track.artistsAll}（預設只取第一位，可自行修改）</span>}
                          {dup ? (
                            <span style={{ color: 'var(--accent)', fontSize: '0.75rem' }}>
                              題庫已有：{r.match!.song.artistName}－{r.match!.song.title}
                              {r.match!.via === 'alias' ? '（符合別名）' : ''}，已取消勾選；修改歌名或歌手可重新比對
                            </span>
                          ) : r.match ? (
                            <span style={smallText}>題庫有同名歌曲（歌手：{r.match.song.artistName}），歌手不同，仍可匯入</span>
                          ) : null}
                          {r.selected && !dup && blocker && <span style={{ color: 'var(--accent)', fontSize: '0.75rem' }}>{blocker}，匯入時會略過這首</span>}
                          {r.track.title !== r.songTitle && (
                            <span title={r.track.title} style={{ ...smallText, fontSize: '0.7rem', overflowWrap: 'anywhere' }}>
                              原歌名：{r.track.title}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', paddingLeft: '28px' }}>
                        <span style={{ color: 'var(--ink-dim)', fontSize: '0.72rem' }}>別名</span>
                        {r.aliases.map((alias) => (
                          <span key={alias} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 4px 2px 10px', borderRadius: '999px', border: '1px solid var(--groove)', fontSize: '0.75rem' }}>
                            {alias}
                            <button
                              type="button"
                              onClick={() => updateRow(r.id, { aliases: r.aliases.filter((a) => a !== alias) })}
                              aria-label={`移除別名「${alias}」`}
                              style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer', width: '22px', height: '22px', lineHeight: 1 }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          value={r.aliasDraft}
                          onChange={(e) => updateRow(r.id, { aliasDraft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              addAlias(r);
                            }
                          }}
                          placeholder="輸入別名後按 Enter"
                          aria-label={`「${r.songTitle || r.track.title}」的別名`}
                          style={{ ...inputStyle, width: '150px', padding: '4px 8px', fontSize: '0.78rem' }}
                        />
                        <button type="button" onClick={() => addAlias(r)} disabled={r.aliasDraft.trim().length === 0} style={{ ...editButtonStyle, padding: '4px 10px', fontSize: '0.75rem' }}>
                          新增
                        </button>
                      </div>

                      {themes.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', paddingLeft: '28px' }}>
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
                                  border: `1px solid ${checked ? 'var(--accent)' : 'var(--groove)'}`,
                                  background: checked ? 'var(--bg)' : 'transparent',
                                  color: checked ? 'var(--accent)' : 'var(--ink-dim)',
                                  fontSize: '0.72rem',
                                }}
                              >
                                <input type="checkbox" checked={checked} onChange={() => toggleTheme(r, t.id)} style={{ width: '11px', height: '11px' }} />
                                {t.name}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {r.themeReason && <span style={{ paddingLeft: '28px', ...smallText }}>自動判斷：{r.themeReason}</span>}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '28px' }}>
                        {renderSourceLine(r, 'youtube')}
                        {renderSourceLine(r, 'apple')}
                        {renderSourceLine(r, 'deezer')}
                        {searchOpen && searchState && (
                          <SourceSearchPanel
                            key={`${r.id}`}
                            defaultQuery={`${r.songTitle} ${r.artistName}`.trim()}
                            initialPlatform={searchState.platform}
                            country={country}
                            rowLabel={`${r.artistName}－${r.songTitle}`}
                            targetDurationSec={knownDuration(r)}
                            onPickYoutube={(c) => pickYoutube(r.id, c)}
                            onPickCandidate={(p, c) => pickCandidate(r.id, p, c)}
                            onClose={() => setSearchState(null)}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <button type="button" onClick={handleImport} disabled={anyBusy || importable.length === 0} style={{ ...buttonStyle, alignSelf: 'flex-start' }}>
                {importing ? '匯入中…' : `批次匯入所選的 ${importable.length} 首`}
              </button>
              <p style={{ ...smallText, margin: 0 }}>
                已勾選但尚未指定來源的歌曲不會匯入，也不會從清單移除，可補上來源後再匯入。勾選套用的 Apple／Deezer 來源會標記為「已人工核對」。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
