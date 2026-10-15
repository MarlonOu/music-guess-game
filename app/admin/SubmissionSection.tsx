'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '../../lib/types/song';
import type { Artist, Theme } from '../../lib/types/theme';
import type { DuplicateReport, SongSubmissionView, SubmissionStatus } from '../../lib/types/submission';
import {
  artistHintsFor,
  buildSongMatchIndex,
  findSongMatch,
  isDuplicateMatch,
  suggestSongFields,
  type SongMatch,
} from '../../lib/engine/songMatch';
import { ALIAS_LIST_SEPARATOR } from '../../lib/csv/songCsv';
import { ManualSourceSearch, PLATFORM_LABEL, type MatchPlatform, type SourceCandidateView } from './ManualSourceSearch';
import { buttonStyle, dangerButtonStyle, editButtonStyle, formatDuration, inputStyle, sectionStyle } from './adminShared';

// ===== 玩家投稿審核（獨立區塊）=====
// 流程與「播放清單匯入」每一首相同：核對歌名／歌手／別名 → 題庫重複比對 → 自動判斷主題 →
// 比對 Apple Music／Deezer 來源（可試聽、可手動搜尋）→ 勾選後一併加入題庫。
// 勾選套用的來源（含低信心）一律標記為「已人工核對」，與批次比對來源的規則一致。

type Counts = Record<SubmissionStatus, number>;
const EMPTY_COUNTS: Counts = { pending: 0, approved: 0, rejected: 0 };
const TAB_LABEL: Record<SubmissionStatus, string> = { pending: '待審核', approved: '已通過', rejected: '已退回' };
const PLATFORMS: MatchPlatform[] = ['apple', 'deezer'];

interface SourceState {
  status: 'idle' | 'found' | 'notfound' | 'error';
  confidence?: 'high' | 'low';
  candidate?: SourceCandidateView;
  durationDiffSec?: number | null;
  note?: string;
  /** 套用這個候選來源 */
  apply: boolean;
  /** 候選來源是管理者手動搜尋指定的 */
  manual?: boolean;
  /** 找不到時：標記「已確認這個平台沒有這首歌」 */
  markSkip: boolean;
  /** 正在比對中 */
  loading?: boolean;
}

const IDLE_SOURCE: SourceState = { status: 'idle', apply: false, markSkip: false };

interface ReviewRow {
  sub: SongSubmissionView;
  selected: boolean;
  songTitle: string;
  artistName: string;
  /** 初始值，用來判斷管理者是否改過（未改時額外使用原始標題與頻道佐證重複比對） */
  suggestedTitle: string;
  suggestedArtist: string;
  aliases: string[];
  aliasDraft: string;
  themeIds: string[];
  themeReason?: string;
  match: SongMatch | null;
  autoDeselected: boolean;
  apple: SourceState;
  deezer: SourceState;
}

function sanitizeAlias(raw: string): string {
  return raw.trim().split(ALIAS_LIST_SEPARATOR).join('；');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const smallText: React.CSSProperties = { color: 'var(--ink-dim)', fontSize: '0.75rem' };

export function SubmissionSection({
  songs,
  artists,
  themes,
  onChanged,
  onError,
  onNotice,
}: {
  songs: Song[];
  artists: Artist[];
  themes: Theme[];
  onChanged: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [tab, setTab] = useState<SubmissionStatus>('pending');
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [history, setHistory] = useState<SongSubmissionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [quickApplyThemeIds, setQuickApplyThemeIds] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState({ done: 0, total: 0 });
  const [country, setCountry] = useState('TW');
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const [previewAudioKey, setPreviewAudioKey] = useState<string | null>(null);
  const [searchKey, setSearchKey] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const seq = useRef(0);
  const rowsRef = useRef<ReviewRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const matchIndex = useMemo(() => {
    const artistNameById = new Map(artists.map((a) => [a.id, a.name]));
    return buildSongMatchIndex(
      songs.map((s) => ({
        id: s.id,
        title: s.title,
        aliases: s.aliases,
        artistName: artistNameById.get(s.artistId) ?? '',
        youtubeVideoId: s.youtubeVideoId,
      }))
    );
  }, [songs, artists]);

  const computeMatch = useCallback(
    (row: Pick<ReviewRow, 'sub' | 'songTitle' | 'artistName' | 'suggestedTitle' | 'suggestedArtist'>): SongMatch | null =>
      findSongMatch(matchIndex, {
        videoId: row.sub.youtubeVideoId,
        rawTitle: row.sub.videoTitle,
        songTitle: row.songTitle,
        artistName: row.artistName,
        channelTitle: row.sub.channelTitle,
        useRaw: row.songTitle === row.suggestedTitle && row.artistName === row.suggestedArtist,
      }),
    [matchIndex]
  );

  const buildRow = useCallback(
    (sub: SongSubmissionView): ReviewRow => {
      const suggestion = suggestSongFields(sub.videoTitle, artistHintsFor(matchIndex, sub.videoTitle, sub.channelTitle));
      const base = {
        sub,
        songTitle: sub.title,
        artistName: sub.artistName,
        suggestedTitle: sub.title,
        suggestedArtist: sub.artistName,
        // 影片標題常帶英文譯名，suggestSongFields 會把它拆成別名；與投稿歌名相同者略過
        aliases: suggestion.aliases.filter((a) => a.trim().toLowerCase() !== sub.title.trim().toLowerCase()),
        aliasDraft: '',
        themeIds: [] as string[],
        autoDeselected: false,
        apple: IDLE_SOURCE,
        deezer: IDLE_SOURCE,
      };
      const match = computeMatch(base);
      const dup = isDuplicateMatch(match);
      return { ...base, match, selected: !dup, autoDeselected: dup };
    },
    [matchIndex, computeMatch]
  );

  const load = useCallback(
    async (status: SubmissionStatus) => {
      const mySeq = ++seq.current;
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/submissions?status=${status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { submissions: SongSubmissionView[]; counts: Counts };
        if (mySeq !== seq.current) return;
        setCounts(data.counts);
        if (status === 'pending') {
          // 保留已編輯過的列（以投稿 id 對應），只新增新投稿、移除已處理的
          const prev = new Map(rowsRef.current.map((r) => [r.sub.id, r]));
          setRows(data.submissions.map((sub) => (prev.has(sub.id) ? { ...prev.get(sub.id)!, sub } : buildRow(sub))));
        } else {
          setHistory(data.submissions);
        }
      } catch {
        if (mySeq === seq.current) onError('讀取投稿清單失敗');
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    },
    [buildRow, onError]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 載入外部資料（投稿清單）
    load(tab);
  }, [tab, load]);

  // 題庫（songs）更新後，重新比對各列是否重複（例如剛通過一首後，同歌手同歌名的投稿會變成重複）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 依外部資料（題庫）重新計算衍生狀態
    setRows((prev) =>
      prev.map((row) => {
        const match = computeMatch(row);
        const dup = isDuplicateMatch(match);
        if (dup && row.selected) return { ...row, match, selected: false, autoDeselected: true };
        if (!dup && row.autoDeselected) return { ...row, match, selected: true, autoDeselected: false };
        return { ...row, match };
      })
    );
  }, [computeMatch]);

  // ---- 列編輯 ----
  function updateRow(id: string, patch: Partial<ReviewRow>) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.sub.id !== id) return row;
        const next = { ...row, ...patch };
        if ('songTitle' in patch || 'artistName' in patch) {
          next.match = computeMatch(next);
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

  function updateSource(id: string, platform: MatchPlatform, patch: Partial<SourceState>) {
    setRows((prev) => prev.map((row) => (row.sub.id === id ? { ...row, [platform]: { ...row[platform], ...patch } } : row)));
  }

  function addAlias(row: ReviewRow) {
    const alias = sanitizeAlias(row.aliasDraft);
    if (!alias) return;
    const exists = [row.songTitle, ...row.aliases].some((a) => a.trim().toLowerCase() === alias.toLowerCase());
    updateRow(row.sub.id, { aliases: exists ? row.aliases : [...row.aliases, alias], aliasDraft: '' });
  }

  function toggleTheme(row: ReviewRow, themeId: string) {
    const has = row.themeIds.includes(themeId);
    updateRow(row.sub.id, { themeIds: has ? row.themeIds.filter((t) => t !== themeId) : [...row.themeIds, themeId] });
  }

  function toggleAll(selected: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, selected: selected && !isDuplicateMatch(r.match), autoDeselected: false })));
  }

  function applyThemesToSelected() {
    if (quickApplyThemeIds.length === 0) return;
    setRows((prev) => prev.map((r) => (r.selected ? { ...r, themeIds: [...quickApplyThemeIds] } : r)));
  }

  const selectedRows = rows.filter((r) => r.selected);

  // ---- 自動判斷主題（與播放清單匯入相同：每批 8 首，結果疊加並附依據）----
  async function handleAutoSuggest() {
    const targets = rows.filter((r) => r.selected);
    if (targets.length === 0 || themes.length === 0) return;
    setSuggesting(true);
    setSuggestNote(null);
    try {
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
            items: chunk.map((r) => ({ key: r.sub.id, title: r.songTitle.trim() || r.sub.videoTitle, artist: r.artistName.trim() || r.sub.channelTitle })),
            themes: themePayload,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          onError(data.error ?? '自動判斷主題失敗');
          break;
        }
        const byKey = new Map<string, { themeIds: string[]; reason: string }>(
          (data.results as { key: string; themeIds: string[]; reason: string }[]).map((r) => [r.key, r])
        );
        withTheme += chunk.filter((r) => (byKey.get(r.sub.id)?.themeIds.length ?? 0) > 0).length;
        factsFound += data.factsFound ?? 0;
        evidenceFound += data.evidenceFound ?? 0;
        if (data.mode === 'rules') mode = 'rules';
        for (const w of (data.warnings ?? []) as string[]) warnings.add(w);
        setRows((prev) =>
          prev.map((row) => {
            const hit = byKey.get(row.sub.id);
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
        `${mode === 'ai' ? 'AI' : '規則'}判斷完成：${targets.length} 首中有 ${withTheme} 首找到建議主題（查到年份／曲風 ${factsFound} 首、維基／新聞佐證 ${evidenceFound} 首）。請檢查後再通過。${warnings.size > 0 ? ' ' + Array.from(warnings).join('；') : ''}`
      );
    } catch {
      onError('自動判斷主題失敗，請檢查網路後再試');
    } finally {
      setSuggesting(false);
    }
  }

  // ---- 來源比對（逐首、逐平台依序呼叫；伺服器端統一節流）----
  async function matchOne(row: ReviewRow, platform: MatchPlatform): Promise<void> {
    updateSource(row.sub.id, platform, { loading: true });
    let next: SourceState = { ...IDLE_SOURCE, status: 'error' };
    try {
      const res = await fetch('/api/songs/match-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          mode: 'fill',
          title: row.songTitle.trim() || row.sub.title,
          artist: row.artistName.trim(),
          aliases: row.aliases,
          durationSec: row.sub.durationSec,
          country,
        }),
      });
      if (!res.ok) {
        next = { ...next, note: res.status === 401 ? '登入已失效，請重新整理頁面' : `伺服器回應 HTTP ${res.status}` };
      } else {
        const data = await res.json();
        if (data.status === 'found') {
          next = {
            status: 'found',
            confidence: data.confidence,
            candidate: data.candidate,
            durationDiffSec: data.durationDiffSec ?? null,
            note: data.note,
            // 高信心預設勾選；低信心必須試聽後自己勾
            apply: data.confidence === 'high',
            markSkip: false,
          };
        } else if (data.status === 'notfound') {
          next = { ...IDLE_SOURCE, status: 'notfound', note: data.note };
        } else {
          next = { ...next, note: data.error ?? '查詢失敗' };
        }
      }
    } catch {
      next = { ...next, note: '網路錯誤' };
    }
    updateSource(row.sub.id, platform, { ...next, loading: false });
  }

  async function runMatching(targets: ReviewRow[], onlyPlatforms: MatchPlatform[] = PLATFORMS) {
    if (targets.length === 0 || matching) return;
    cancelRef.current = false;
    setMatching(true);
    const total = targets.length * onlyPlatforms.length;
    setMatchProgress({ done: 0, total });
    let done = 0;
    for (const row of targets) {
      for (const platform of onlyPlatforms) {
        if (cancelRef.current) break;
        await matchOne(row, platform);
        done += 1;
        setMatchProgress({ done, total });
      }
      if (cancelRef.current) break;
    }
    setMatching(false);
  }

  function pickManual(id: string, platform: MatchPlatform, candidate: SourceCandidateView) {
    updateSource(id, platform, {
      status: 'found',
      confidence: undefined,
      candidate,
      durationDiffSec: null,
      note: undefined,
      manual: true,
      apply: true,
      markSkip: false,
    });
    setSearchKey(null);
    setPreviewAudioKey(null);
  }

  // ---- 通過／退回／刪除 ----
  function sourcePayload(s: SourceState) {
    if (s.apply && s.candidate) return { trackId: s.candidate.trackId, previewUrl: s.candidate.previewUrl, verified: true };
    if (s.status === 'notfound' && s.markSkip) return { skip: true };
    return undefined;
  }

  async function approveSelected() {
    const targets = rows.filter((r) => r.selected && !isDuplicateMatch(r.match));
    if (targets.length === 0 || approving) return;
    setApproving(true);
    let ok = 0;
    const failed: string[] = [];
    try {
      for (const r of targets) {
        const aliases = (() => {
          const title = (r.songTitle.trim() || r.sub.title).toLowerCase();
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
        })();
        try {
          const res = await fetch(`/api/admin/submissions/${encodeURIComponent(r.sub.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'approve',
              title: r.songTitle.trim() || r.sub.title,
              artistName: r.artistName.trim(),
              aliases,
              themeIds: r.themeIds,
              apple: sourcePayload(r.apple),
              deezer: sourcePayload(r.deezer),
            }),
          });
          if (res.ok) ok += 1;
          else {
            const data = await res.json().catch(() => ({}));
            failed.push(`${r.songTitle || r.sub.title}（${data.error ?? `HTTP ${res.status}`}）`);
          }
        } catch {
          failed.push(`${r.songTitle || r.sub.title}（網路錯誤）`);
        }
      }
      if (ok > 0) {
        onNotice(`已通過 ${ok} 首並加入題庫${failed.length > 0 ? `，${failed.length} 首失敗` : ''}`);
        onChanged();
      }
      if (failed.length > 0) onError(`通過失敗：${failed.join('；')}`);
      await load('pending');
    } finally {
      setApproving(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, okMsg: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/submissions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(typeof data.error === 'string' ? data.error : '操作失敗');
        return;
      }
      onNotice(okMsg);
      setRejectingId(null);
      setRejectReason('');
      await load(tab);
      // 退回／重新審核會改變另一個分頁的數量，順便刷新計數
      if (tab !== 'pending') load('pending');
    } catch {
      onError('網路錯誤，請稍後再試');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/submissions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        onError('刪除失敗');
        return;
      }
      onNotice('已刪除投稿紀錄');
      setConfirmDeleteId(null);
      await load(tab);
    } catch {
      onError('網路錯誤，請稍後再試');
    } finally {
      setBusyId(null);
    }
  }

  // ---- 畫面 ----
  const dupCount = rows.filter((r) => isDuplicateMatch(r.match)).length;
  const approvable = rows.filter((r) => r.selected && !isDuplicateMatch(r.match)).length;
  const anyBusy = approving || matching || suggesting;

  function renderServerNotes(report: DuplicateReport | undefined) {
    const notes = (report?.reasons ?? []).filter((x) => x.code === 'pending-same' || x.code === 'pending-title' || x.code === 'rejected-video');
    if (notes.length === 0) return null;
    return (
      <>
        {notes.map((n, i) => (
          <span key={`${n.code}-${i}`} style={{ color: n.level === 'block' ? 'var(--error)' : 'var(--accent)', fontSize: '0.75rem' }}>
            {n.message}
            {n.match && `（${n.match.artist}－${n.match.title}）`}
          </span>
        ))}
      </>
    );
  }

  function renderSource(row: ReviewRow, platform: MatchPlatform) {
    const s = row[platform];
    const key = `${row.sub.id}:${platform}`;
    const label = `${row.artistName}－${row.songTitle}`;
    return (
      <div key={platform} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {s.candidate ? (
            <input
              type="checkbox"
              checked={s.apply}
              onChange={(e) => updateSource(row.sub.id, platform, { apply: e.target.checked })}
              aria-label={`套用 ${PLATFORM_LABEL[platform]} 來源：${label}`}
              style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
            />
          ) : (
            <span style={{ width: '16px' }} aria-hidden />
          )}
          <span style={{ fontSize: '0.72rem', padding: '1px 8px', borderRadius: '999px', border: '1px solid var(--groove)', color: 'var(--ink-dim)' }}>
            {PLATFORM_LABEL[platform]}
          </span>
          {s.loading && <span style={smallText}>比對中…</span>}
          {!s.loading && s.status === 'idle' && <span style={smallText}>尚未比對</span>}
          {s.manual && <span style={{ fontSize: '0.72rem', color: 'var(--success)' }}>手動指定</span>}
          {s.confidence === 'high' && <span style={{ fontSize: '0.72rem', color: 'var(--success)' }}>高信心</span>}
          {s.confidence === 'low' && <span style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>低信心：請試聽確認</span>}
          {s.status === 'notfound' && <span style={smallText}>找不到{s.note ? `（${s.note}）` : ''}</span>}
          {s.status === 'error' && <span style={{ fontSize: '0.72rem', color: 'var(--error)' }}>失敗：{s.note}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
            <button
              type="button"
              disabled={matching || s.loading}
              onClick={() => runMatching([row], [platform])}
              style={{ ...editButtonStyle, padding: '2px 10px', fontSize: '0.75rem', minHeight: '32px' }}
            >
              {s.status === 'idle' ? '自動比對' : '重新比對'}
            </button>
            <button
              type="button"
              aria-expanded={searchKey === key}
              onClick={() => setSearchKey((k) => (k === key ? null : key))}
              style={{ ...editButtonStyle, padding: '2px 10px', fontSize: '0.75rem', minHeight: '32px' }}
            >
              {searchKey === key ? '收起搜尋' : '手動搜尋'}
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
            <button
              type="button"
              style={{ ...editButtonStyle, padding: '2px 10px', fontSize: '0.75rem', minHeight: '32px' }}
              onClick={() => setPreviewAudioKey((k) => (k === key ? null : key))}
            >
              {previewAudioKey === key ? '收起試聽' : '試聽'}
            </button>
            {previewAudioKey === key && <audio controls autoPlay src={s.candidate.previewUrl} style={{ height: '32px', maxWidth: '100%' }} />}
          </div>
        )}
        {s.status === 'notfound' && (
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingLeft: '24px', ...smallText }}>
            <input type="checkbox" checked={s.markSkip} onChange={(e) => updateSource(row.sub.id, platform, { markSkip: e.target.checked })} />
            標記為「已確認 {PLATFORM_LABEL[platform]} 找不到」，之後批次比對略過這首
          </label>
        )}
        {searchKey === key && (
          <ManualSourceSearch
            platform={platform}
            defaultQuery={`${row.songTitle} ${row.artistName}`.trim()}
            country={country}
            targetDurationSec={row.sub.durationSec}
            rowLabel={label}
            onPick={(c) => pickManual(row.sub.id, platform, c)}
            onClose={() => setSearchKey(null)}
          />
        )}
      </div>
    );
  }

  return (
    <section style={sectionStyle} aria-labelledby="submission-heading">
      <h2 id="submission-heading" style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
        玩家投稿審核
        {counts.pending > 0 && (
          <span
            aria-label={`${counts.pending} 筆待審核`}
            style={{ fontSize: '0.75rem', fontWeight: 700, padding: '1px 9px', borderRadius: '999px', background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            {counts.pending}
          </span>
        )}
      </h2>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', margin: 0 }}>
        玩家從首頁「投稿題目」送出的 YouTube 影片。每首的流程與播放清單匯入相同：核對歌名／歌手／別名、自動判斷主題、比對 Apple Music／Deezer 來源，勾選後一併通過並加入題庫；勾選套用的來源會標記為「已人工核對」。
      </p>

      <div role="group" aria-label="投稿狀態" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {(Object.keys(TAB_LABEL) as SubmissionStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={tab === s}
            onClick={() => setTab(s)}
            className={`btn btn-toggle btn-sm${tab === s ? ' is-active' : ''}`}
            style={{ minHeight: '44px' }}
          >
            {TAB_LABEL[s]}（{counts[s]}）
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {loading && (tab === 'pending' ? rows.length === 0 : history.length === 0) ? (
          <span style={smallText}>載入中…</span>
        ) : (tab === 'pending' ? rows.length === 0 : history.length === 0) ? (
          <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
            {tab === 'pending' ? '目前沒有待審核的投稿' : `沒有${TAB_LABEL[tab]}的紀錄`}
          </span>
        ) : null}
      </div>

      {tab === 'pending' && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
              共 {rows.length} 首，已選 {selectedRows.length} 首
              {dupCount > 0 && `（${dupCount} 首題庫裡已經有了，不可通過）`}
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
                      onChange={() => setQuickApplyThemeIds((prev) => (checked ? prev.filter((id) => id !== t.id) : [...prev, t.id]))}
                    />
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
                <button
                  type="button"
                  onClick={handleAutoSuggest}
                  disabled={anyBusy || selectedRows.length === 0}
                  style={{ ...buttonStyle, padding: '8px 14px', fontSize: '0.85rem' }}
                >
                  {suggesting ? '判斷中…' : `自動判斷已勾選 ${selectedRows.length} 首的主題`}
                </button>
              )}
              {!matching ? (
                <button
                  type="button"
                  onClick={() => runMatching(selectedRows)}
                  disabled={anyBusy || selectedRows.length === 0}
                  style={{ ...buttonStyle, padding: '8px 14px', fontSize: '0.85rem' }}
                >
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
            <span style={smallText}>
              主題：查年份／曲風，再依既有主題挑選；來源：逐首用歌名＋歌手搜尋，高信心預設勾選、低信心請試聽後自己勾。結果都只是建議，可逐首修改。
            </span>
            {matching && (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={matchProgress.total}
                aria-valuenow={matchProgress.done}
                aria-label="來源比對進度"
                style={{ height: '6px', borderRadius: '999px', background: 'var(--groove)', overflow: 'hidden' }}
              >
                <div
                  style={{
                    width: `${matchProgress.total ? (matchProgress.done / matchProgress.total) * 100 : 0}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    transition: 'width 200ms ease-out',
                  }}
                />
              </div>
            )}
            {suggestNote && <p style={{ color: 'var(--success)', fontSize: '0.8rem', margin: 0 }}>{suggestNote}</p>}
          </div>

          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '720px',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
            }}
          >
            {rows.map((r) => {
              const dup = isDuplicateMatch(r.match);
              const rejecting = rejectingId === r.sub.id;
              return (
                <li
                  key={r.sub.id}
                  style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${dup ? 'var(--accent)' : 'var(--groove)'}` }}
                >
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={r.selected}
                      disabled={dup}
                      aria-label={`選取「${r.songTitle || r.sub.title}」`}
                      onChange={(e) => updateRow(r.sub.id, { selected: e.target.checked, autoDeselected: false })}
                      style={{ marginTop: '14px', width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element -- 縮圖來自 YouTube 外部網域 */}
                    <img src={r.sub.thumbnailUrl} alt="" width={64} height={36} loading="lazy" style={{ borderRadius: '4px', flexShrink: 0, marginTop: '6px', background: 'var(--groove)' }} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <input
                          value={r.songTitle}
                          onChange={(e) => updateRow(r.sub.id, { songTitle: e.target.value })}
                          placeholder="歌名"
                          aria-label="歌名"
                          style={{ ...inputStyle, flex: '1 1 180px', minWidth: 0 }}
                        />
                        <input
                          value={r.artistName}
                          onChange={(e) => updateRow(r.sub.id, { artistName: e.target.value })}
                          placeholder="歌手名稱"
                          aria-label="歌手名稱"
                          style={{ ...inputStyle, flex: '0 1 140px', minWidth: 0 }}
                        />
                      </div>
                      {dup && r.match ? (
                        <span style={{ color: 'var(--accent)', fontSize: '0.75rem' }}>
                          題庫已有：{r.match.song.artistName}－{r.match.song.title}
                          {r.match.via === 'video' ? '（同一支影片）' : r.match.via === 'alias' ? '（符合別名）' : ''}
                          ，不可通過；修改歌名或歌手可重新比對，或退回這筆投稿
                        </span>
                      ) : r.match ? (
                        <span style={smallText}>題庫有同名歌曲（歌手：{r.match.song.artistName}），歌手不同，仍可通過</span>
                      ) : (
                        <span style={smallText}>題庫目前沒有這首歌</span>
                      )}
                      {renderServerNotes(r.sub.report)}
                      <span title={r.sub.videoTitle} style={{ ...smallText, fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        原標題：{r.sub.videoTitle}・{r.sub.channelTitle}・{formatDuration(r.sub.durationSec)}
                      </span>
                      <span style={{ ...smallText, fontSize: '0.7rem' }}>
                        投稿者「{r.sub.submitterName}」・{formatDate(r.sub.createdAt)}
                        {r.sub.note && `・備註：${r.sub.note}`}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingLeft: '26px' }}>
                    <button
                      type="button"
                      aria-expanded={previewVideoId === r.sub.id}
                      onClick={() => setPreviewVideoId((v) => (v === r.sub.id ? null : r.sub.id))}
                      style={{ ...editButtonStyle, minHeight: '36px' }}
                    >
                      {previewVideoId === r.sub.id ? '收起影片' : '預覽影片'}
                    </button>
                    <button type="button" disabled={busyId !== null} onClick={() => setRejectingId(rejecting ? null : r.sub.id)} style={{ ...editButtonStyle, minHeight: '36px' }}>
                      退回
                    </button>
                  </div>

                  {previewVideoId === r.sub.id && (
                    <div style={{ marginLeft: '26px', position: 'relative', width: 'calc(100% - 26px)', maxWidth: '480px', aspectRatio: '16 / 9', borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
                      <iframe
                        title={`預覽：${r.sub.videoTitle}`}
                        src={`https://www.youtube-nocookie.com/embed/${r.sub.youtubeVideoId}?rel=0`}
                        allow="encrypted-media; picture-in-picture"
                        allowFullScreen
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                      />
                    </div>
                  )}

                  {rejecting && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', paddingLeft: '26px' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.78rem', color: 'var(--ink-dim)', flex: '1 1 220px' }}>
                        退回原因（選填，同一支影片再被投稿時會顯示）
                        <input
                          value={rejectReason}
                          maxLength={200}
                          autoFocus
                          onChange={(e) => setRejectReason(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) patch(r.sub.id, { action: 'reject', reviewNote: rejectReason }, '已退回投稿');
                          }}
                          placeholder="例如：非原曲、音質太差、不適合題庫"
                          style={inputStyle}
                        />
                      </label>
                      <button type="button" disabled={busyId !== null} onClick={() => patch(r.sub.id, { action: 'reject', reviewNote: rejectReason }, '已退回投稿')} style={{ ...dangerButtonStyle, minHeight: '44px' }}>
                        確定退回
                      </button>
                      <button type="button" onClick={() => setRejectingId(null)} style={{ ...editButtonStyle, minHeight: '44px' }}>
                        取消
                      </button>
                    </div>
                  )}

                  {/* 別名管理：與播放清單匯入相同，通過時寫入 aliases */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', paddingLeft: '26px' }}>
                    <span style={{ color: 'var(--ink-dim)', fontSize: '0.72rem' }}>別名</span>
                    {r.aliases.map((alias) => (
                      <span key={alias} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 4px 2px 10px', borderRadius: '999px', border: '1px solid var(--groove)', fontSize: '0.75rem' }}>
                        {alias}
                        <button
                          type="button"
                          onClick={() => updateRow(r.sub.id, { aliases: r.aliases.filter((a) => a !== alias) })}
                          aria-label={`移除別名「${alias}」`}
                          style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer', width: '22px', height: '22px', lineHeight: 1 }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      value={r.aliasDraft}
                      onChange={(e) => updateRow(r.sub.id, { aliasDraft: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          addAlias(r);
                        }
                      }}
                      placeholder="輸入別名後按 Enter"
                      aria-label={`「${r.songTitle || r.sub.title}」的別名`}
                      style={{ ...inputStyle, width: '150px', padding: '4px 8px', fontSize: '0.78rem' }}
                    />
                    <button type="button" onClick={() => addAlias(r)} disabled={r.aliasDraft.trim().length === 0} style={{ ...editButtonStyle, padding: '4px 10px', fontSize: '0.75rem' }}>
                      新增
                    </button>
                  </div>

                  {themes.length > 0 && (
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
                  {r.themeReason && <span style={{ paddingLeft: '26px', ...smallText }}>自動判斷：{r.themeReason}</span>}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '26px' }}>
                    {PLATFORMS.map((p) => renderSource(r, p))}
                  </div>
                </li>
              );
            })}
          </ul>

          <button type="button" onClick={approveSelected} disabled={approving || matching || approvable === 0} style={{ ...buttonStyle, alignSelf: 'flex-start' }}>
            {approving ? '通過中…' : `通過所選的 ${approvable} 首並加入題庫`}
          </button>
          <p style={{ ...smallText, margin: 0 }}>
            未比對來源的歌曲會以 YouTube 為唯一來源加入題庫，之後仍可用「批次比對來源」補上。歌名與歌手改動後會重新比對題庫。
          </p>
        </>
      )}

      {tab !== 'pending' && history.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '560px', overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {history.map((sub) => (
            <li key={sub.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--groove)' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- 縮圖來自 YouTube 外部網域 */}
                <img src={sub.thumbnailUrl} alt="" width={64} height={36} loading="lazy" style={{ borderRadius: '4px', flexShrink: 0, background: 'var(--groove)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {sub.artistName}－{sub.title}
                  </span>
                  <span style={smallText}>
                    投稿者「{sub.submitterName}」・{formatDate(sub.createdAt)}
                    {sub.reviewedAt && `・審核於 ${formatDate(sub.reviewedAt)}`}
                  </span>
                  {sub.status === 'rejected' && <span style={{ ...smallText, color: 'var(--ink)' }}>退回原因：{sub.reviewNote || '（未填寫）'}</span>}
                  {sub.status === 'approved' && <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>已加入題庫</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {sub.status === 'rejected' && (
                  <button type="button" disabled={busyId !== null} onClick={() => patch(sub.id, { action: 'reopen' }, '已改回待審核')} style={{ ...editButtonStyle, minHeight: '44px' }}>
                    重新審核
                  </button>
                )}
                {confirmDeleteId === sub.id ? (
                  <>
                    <span style={{ fontSize: '0.82rem', color: 'var(--ink-dim)' }}>刪除這筆紀錄？（不影響已加入的歌曲）</span>
                    <button type="button" disabled={busyId !== null} onClick={() => remove(sub.id)} style={{ ...dangerButtonStyle, minHeight: '44px' }}>
                      確定刪除
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteId(null)} style={{ ...editButtonStyle, minHeight: '44px' }}>
                      取消
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmDeleteId(sub.id)} style={{ ...dangerButtonStyle, minHeight: '44px' }}>
                    刪除紀錄
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
