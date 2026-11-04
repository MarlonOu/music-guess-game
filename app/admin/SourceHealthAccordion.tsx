'use client';

import { useMemo, useRef, useState } from 'react';
import type { Song } from '../../lib/types/song';
import type { Artist } from '../../lib/types/theme';
import {
  HEALTH_PLATFORM_LABEL,
  type HealthFinding,
  type HealthPlatform,
  type HealthScanResult,
} from '../../lib/types/sourceHealth';
import { buttonStyle, dangerButtonStyle, editButtonStyle } from './adminShared';

// ===== 來源健康檢查 =====
// 掃描題庫裡每首歌的 YouTube／Apple Music／Deezer 來源狀態（已刪除／私人／關閉嵌入／地區封鎖／下架／
// 沒有試聽／試聽網址過期或失效…），列出有問題的歌曲，並提供「刷新網址」「移除來源」的一鍵修復。
// 掃描只讀取不寫入；分批送出（YouTube／Apple 每批 50 首、Deezer 每批 10 首）避免單次請求過久。

const PLATFORMS: HealthPlatform[] = ['youtube', 'apple', 'deezer'];
const CHUNK: Record<HealthPlatform, number> = { youtube: 50, apple: 50, deezer: 10 };
const PAGE_SIZE = 40;

function hasSource(song: Song, p: HealthPlatform): boolean {
  if (p === 'youtube') return Boolean(song.youtubeVideoId);
  if (p === 'apple') return Boolean(song.appleMusicTrackId || song.appleMusicPreviewUrl);
  return Boolean(song.deezerTrackId || song.deezerPreviewUrl);
}

const smallText: React.CSSProperties = { color: 'var(--ink-dim)', fontSize: '0.75rem' };
const miniButton: React.CSSProperties = { ...editButtonStyle, padding: '2px 10px', fontSize: '0.75rem', minHeight: '36px' };

interface SongIssue {
  song: Song;
  findings: HealthFinding[];
  hasError: boolean;
  /** 所有現有來源都有「錯誤」：這首歌目前實際上無法播放 */
  unplayable: boolean;
}

export function SourceHealthAccordion({
  songs,
  artists,
  onChanged,
  onError,
  onNotice,
}: {
  songs: Song[];
  artists: Artist[];
  onChanged: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Record<HealthPlatform, boolean>>({ youtube: true, apple: true, deezer: true });
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [findings, setFindings] = useState<HealthFinding[]>([]);
  const [scanned, setScanned] = useState<Record<HealthPlatform, number | null>>({ youtube: null, apple: null, deezer: null });
  const [scanErrors, setScanErrors] = useState<Partial<Record<HealthPlatform, string>>>({});
  const [scannedAt, setScannedAt] = useState<Date | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<HealthPlatform | 'all'>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const artistNameById = useMemo(() => new Map(artists.map((a) => [a.id, a.name])), [artists]);
  const songById = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);

  const issues: SongIssue[] = useMemo(() => {
    const bySong = new Map<string, HealthFinding[]>();
    for (const f of findings) {
      if (!songById.has(f.songId)) continue;
      const list = bySong.get(f.songId) ?? [];
      list.push(f);
      bySong.set(f.songId, list);
    }
    const out: SongIssue[] = [];
    for (const [songId, list] of bySong) {
      const song = songById.get(songId)!;
      const existing = PLATFORMS.filter((p) => hasSource(song, p));
      const allScanned = existing.every((p) => scanned[p] !== null);
      const erroredPlatforms = new Set(list.filter((f) => f.severity === 'error' && f.code !== 'check-failed').map((f) => f.platform));
      out.push({
        song,
        findings: list,
        hasError: list.some((f) => f.severity === 'error'),
        unplayable: allScanned && existing.length > 0 && existing.every((p) => erroredPlatforms.has(p)),
      });
    }
    out.sort((a, b) => Number(b.unplayable) - Number(a.unplayable) || Number(b.hasError) - Number(a.hasError) || a.song.title.localeCompare(b.song.title, 'zh-Hant'));
    return out;
  }, [findings, songById, scanned]);

  const filtered = issues
    .map((i) => ({
      ...i,
      findings: i.findings.filter((f) => (!onlyErrors || f.severity === 'error') && (platformFilter === 'all' || f.platform === platformFilter)),
    }))
    .filter((i) => i.findings.length > 0);

  const errorSongs = issues.filter((i) => i.hasError).length;
  const warnOnlySongs = issues.length - errorSongs;
  const unplayableCount = issues.filter((i) => i.unplayable).length;
  const refreshable = findings.filter((f) => f.fix === 'refresh');
  const anyScanned = PLATFORMS.some((p) => scanned[p] !== null);
  const anyBusy = scanning || bulkRefreshing || busyKey !== null;

  async function runScan() {
    const platforms = PLATFORMS.filter((p) => selected[p]);
    if (platforms.length === 0 || scanning) return;
    cancelRef.current = false;
    setScanning(true);
    setFindings([]);
    setScanErrors({});
    setScanned({ youtube: null, apple: null, deezer: null });
    setVisible(PAGE_SIZE);
    setPreviewKey(null);
    setConfirmRemove(null);
    const targets = new Map(platforms.map((p) => [p, songs.filter((s) => hasSource(s, p))]));
    const total = platforms.reduce((n, p) => n + targets.get(p)!.length, 0);
    let done = 0;
    setProgress({ done: 0, total, label: '' });
    for (const p of platforms) {
      const list = targets.get(p)!;
      let checked = 0;
      let failed = false;
      for (let i = 0; i < list.length; i += CHUNK[p]) {
        if (cancelRef.current) break;
        const chunk = list.slice(i, i + CHUNK[p]);
        setProgress({ done, total, label: `${HEALTH_PLATFORM_LABEL[p]}…` });
        try {
          const res = await fetch('/api/admin/source-health/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: p, songIds: chunk.map((s) => s.id) }),
          });
          const data = (await res.json().catch(() => ({}))) as Partial<HealthScanResult> & { error?: string };
          if (!res.ok) {
            setScanErrors((e) => ({ ...e, [p]: data.error ?? `掃描失敗（HTTP ${res.status}）` }));
            failed = true;
            break;
          }
          checked += data.checked ?? chunk.length;
          const found = data.findings ?? [];
          if (found.length > 0) setFindings((prev) => [...prev, ...found]);
        } catch {
          setScanErrors((e) => ({ ...e, [p]: '網路錯誤，掃描中斷' }));
          failed = true;
          break;
        }
        done += chunk.length;
        setProgress({ done, total, label: '' });
      }
      if (cancelRef.current) break;
      // 該平台中途失敗就不標記為已掃描（避免誤判「完全無法播放」）
      if (!failed) setScanned((s) => ({ ...s, [p]: checked }));
      else done += Math.max(0, list.length - checked);
    }
    setScannedAt(new Date());
    setScanning(false);
  }

  function dropFindings(songId: string, platform: HealthPlatform) {
    setFindings((prev) => prev.filter((f) => !(f.songId === songId && f.platform === platform)));
  }

  async function applyFix(songId: string, platform: HealthPlatform, action: 'refresh' | 'remove'): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/source-health/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId, platform, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(data.error ?? `修復失敗（HTTP ${res.status}）`);
        return false;
      }
      dropFindings(songId, platform);
      return true;
    } catch {
      onError('網路錯誤，修復失敗');
      return false;
    }
  }

  async function handleFix(f: HealthFinding, action: 'refresh' | 'remove') {
    if (anyBusy) return;
    const key = `${f.songId}:${f.platform}:${action}`;
    setBusyKey(key);
    setConfirmRemove(null);
    const ok = await applyFix(f.songId, f.platform, action);
    setBusyKey(null);
    if (ok) {
      onNotice(action === 'refresh' ? `已刷新 ${HEALTH_PLATFORM_LABEL[f.platform]} 試聽網址` : `已移除 ${HEALTH_PLATFORM_LABEL[f.platform]} 來源`);
      onChanged();
    }
  }

  async function refreshAll() {
    const targets = refreshable.filter((f, i, arr) => arr.findIndex((x) => x.songId === f.songId && x.platform === f.platform) === i);
    if (targets.length === 0 || anyBusy) return;
    cancelRef.current = false;
    setBulkRefreshing(true);
    let ok = 0;
    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break;
      setProgress({ done: i, total: targets.length, label: '刷新中…' });
      if (await applyFix(targets[i].songId, targets[i].platform, 'refresh')) ok += 1;
    }
    setProgress({ done: 0, total: 0, label: '' });
    setBulkRefreshing(false);
    onNotice(`已刷新 ${ok} / ${targets.length} 個來源的試聽網址`);
    if (ok > 0) onChanged();
  }

  function playUrl(song: Song, p: HealthPlatform): string | null {
    if (p === 'apple') return song.appleMusicPreviewUrl ?? null;
    if (p === 'deezer') return song.deezerPlayUrl ?? song.deezerPreviewUrl ?? null;
    return null;
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
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          來源健康檢查
          {anyScanned && issues.length > 0 && (
            <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '1px 9px', borderRadius: '999px', background: errorSongs > 0 ? 'var(--error)' : 'var(--accent)', color: errorSongs > 0 ? '#fff' : 'var(--accent-ink)' }}>
              {issues.length}
            </span>
          )}
        </span>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>{open ? '收合' : '展開'}</span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--groove)' }}>
          <p style={{ ...smallText, margin: 0 }}>
            自動掃描題庫裡每首歌的 YouTube／Apple Music／Deezer 來源：找出已刪除、私人、關閉嵌入授權、地區封鎖、已下架、沒有試聽片段、試聽網址過期或失效的來源。掃描只讀取、不會修改資料。
          </p>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {PLATFORMS.map((p) => {
              const count = songs.filter((s) => hasSource(s, p)).length;
              return (
                <label
                  key={p}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: '999px',
                    border: `1px solid ${selected[p] ? 'var(--accent)' : 'var(--groove)'}`,
                    color: selected[p] ? 'var(--accent)' : 'var(--ink-dim)',
                    fontSize: '0.85rem',
                    cursor: scanning ? 'default' : 'pointer',
                  }}
                >
                  <input type="checkbox" checked={selected[p]} disabled={scanning} onChange={(e) => setSelected((s) => ({ ...s, [p]: e.target.checked }))} style={{ accentColor: 'var(--accent)' }} />
                  {HEALTH_PLATFORM_LABEL[p]}（{count} 首）
                </label>
              );
            })}
            {!scanning ? (
              <button type="button" onClick={runScan} disabled={anyBusy || !PLATFORMS.some((p) => selected[p])} style={{ ...buttonStyle, padding: '8px 16px', fontSize: '0.85rem', minHeight: '44px' }}>
                {anyScanned ? '重新掃描' : '開始掃描'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                style={{ ...editButtonStyle, minHeight: '44px' }}
              >
                停止掃描
              </button>
            )}
          </div>

          <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(scanning || bulkRefreshing) && progress.total > 0 && (
              <>
                <span style={smallText}>
                  {progress.label} {progress.done} / {progress.total}
                </span>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.done}
                  aria-label="掃描進度"
                  style={{ height: '6px', borderRadius: '999px', background: 'var(--groove)', overflow: 'hidden' }}
                >
                  <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: '100%', background: 'var(--accent)', transition: 'width 200ms ease-out' }} />
                </div>
              </>
            )}
            {(Object.keys(scanErrors) as HealthPlatform[]).map((p) => (
              <span key={p} role="alert" style={{ color: 'var(--error)', fontSize: '0.8rem' }}>
                {HEALTH_PLATFORM_LABEL[p]} 掃描未完成：{scanErrors[p]}
              </span>
            ))}
          </div>

          {anyScanned && !scanning && (
            <>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <SummaryChip label="無法播放" value={unplayableCount} tone={unplayableCount > 0 ? 'error' : 'ok'} />
                <SummaryChip label="有錯誤" value={errorSongs} tone={errorSongs > 0 ? 'error' : 'ok'} />
                <SummaryChip label="僅警告" value={warnOnlySongs} tone={warnOnlySongs > 0 ? 'warn' : 'ok'} />
                <span style={smallText}>
                  已檢查：
                  {PLATFORMS.filter((p) => scanned[p] !== null)
                    .map((p) => `${HEALTH_PLATFORM_LABEL[p]} ${scanned[p]} 首`)
                    .join('、')}
                  {scannedAt && `・${scannedAt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`}
                </span>
              </div>

              {issues.length === 0 ? (
                <p style={{ color: 'var(--success)', fontSize: '0.88rem', margin: 0 }}>所有已檢查的來源狀態正常，沒有發現問題。</p>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" aria-pressed={onlyErrors} onClick={() => setOnlyErrors((v) => !v)} style={{ ...editButtonStyle, minHeight: '44px', ...(onlyErrors ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}>
                      只看錯誤
                    </button>
                    {(['all', ...PLATFORMS] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={platformFilter === p}
                        onClick={() => setPlatformFilter(p)}
                        style={{ ...editButtonStyle, minHeight: '44px', ...(platformFilter === p ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}
                      >
                        {p === 'all' ? '全部平台' : HEALTH_PLATFORM_LABEL[p]}
                      </button>
                    ))}
                    {refreshable.length > 0 &&
                      (bulkRefreshing ? (
                        <button
                          type="button"
                          onClick={() => {
                            cancelRef.current = true;
                          }}
                          style={{ ...editButtonStyle, minHeight: '44px' }}
                        >
                          停止刷新
                        </button>
                      ) : (
                        <button type="button" disabled={anyBusy} onClick={refreshAll} style={{ ...buttonStyle, padding: '8px 14px', fontSize: '0.85rem', minHeight: '44px' }}>
                          刷新全部可刷新的網址（{refreshable.length}）
                        </button>
                      ))}
                  </div>

                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {filtered.slice(0, visible).map((issue) => (
                      <li key={issue.song.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${issue.unplayable ? 'var(--error)' : 'var(--groove)'}` }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.92rem', overflowWrap: 'anywhere' }}>
                            {artistNameById.get(issue.song.artistId) ?? '未知歌手'}－{issue.song.title}
                          </span>
                          {issue.unplayable && <span style={{ fontSize: '0.72rem', color: '#fff', background: 'var(--error)', borderRadius: '999px', padding: '1px 8px' }}>目前無法播放</span>}
                        </div>
                        {issue.findings.map((f) => {
                          const key = `${f.songId}:${f.platform}`;
                          const url = playUrl(issue.song, f.platform);
                          return (
                            <div key={`${f.platform}-${f.code}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '8px', borderLeft: `3px solid ${f.severity === 'error' ? 'var(--error)' : 'var(--accent)'}` }}>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.72rem', padding: '1px 8px', borderRadius: '999px', border: '1px solid var(--groove)', color: 'var(--ink-dim)' }}>{HEALTH_PLATFORM_LABEL[f.platform]}</span>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: f.severity === 'error' ? 'var(--error)' : 'var(--accent)' }}>{f.severity === 'error' ? '錯誤' : '警告'}</span>
                                <span style={{ fontSize: '0.82rem', flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>{f.message}</span>
                              </div>
                              {f.detail && <span style={{ ...smallText, overflowWrap: 'anywhere' }}>{f.detail}</span>}
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                                {f.platform === 'youtube' && issue.song.youtubeVideoId && (
                                  <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(issue.song.youtubeVideoId)}`} target="_blank" rel="noopener noreferrer" style={{ ...miniButton, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
                                    開啟影片
                                  </a>
                                )}
                                {url && (
                                  <button type="button" style={miniButton} aria-pressed={previewKey === key} onClick={() => setPreviewKey((k) => (k === key ? null : key))}>
                                    {previewKey === key ? '收起試聽' : '試聽目前網址'}
                                  </button>
                                )}
                                {f.fix === 'refresh' && (
                                  <button type="button" disabled={anyBusy} style={{ ...miniButton, borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => handleFix(f, 'refresh')}>
                                    {busyKey === `${key}:refresh` ? '刷新中…' : '刷新網址'}
                                  </button>
                                )}
                                {f.fix === 'remove' &&
                                  (confirmRemove === key ? (
                                    <>
                                      <button type="button" disabled={anyBusy} style={{ ...dangerButtonStyle, minHeight: '36px' }} onClick={() => handleFix(f, 'remove')}>
                                        {busyKey === `${key}:remove` ? '移除中…' : `確認移除 ${HEALTH_PLATFORM_LABEL[f.platform]} 來源`}
                                      </button>
                                      <button type="button" style={miniButton} onClick={() => setConfirmRemove(null)}>
                                        取消
                                      </button>
                                    </>
                                  ) : (
                                    <button type="button" disabled={anyBusy} style={{ ...miniButton, color: 'var(--error)', borderColor: 'var(--error)' }} onClick={() => setConfirmRemove(key)}>
                                      移除此來源
                                    </button>
                                  ))}
                              </div>
                              {previewKey === key && url && <audio controls autoPlay src={url} style={{ height: '32px', maxWidth: '100%' }} />}
                            </div>
                          );
                        })}
                      </li>
                    ))}
                  </ul>
                  {filtered.length > visible && (
                    <button type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)} style={{ ...editButtonStyle, alignSelf: 'flex-start', minHeight: '44px' }}>
                      顯示更多（還有 {filtered.length - visible} 首）
                    </button>
                  )}
                  <p style={{ ...smallText, margin: 0 }}>
                    「移除此來源」只清除該平台的欄位；移除後若歌曲沒有其他來源會被拒絕。移除後可到「批次比對來源」重新比對補上。Deezer 的「不可播放」判斷依伺服器所在地區而定，僅供參考。
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'error' }) {
  const color = tone === 'error' ? 'var(--error)' : tone === 'warn' ? 'var(--accent)' : 'var(--success)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px', padding: '4px 12px', borderRadius: '999px', border: `1px solid ${color}`, fontSize: '0.8rem' }}>
      <span style={{ color: 'var(--ink-dim)' }}>{label}</span>
      <b style={{ color, fontSize: '0.95rem' }}>{value}</b>
    </span>
  );
}
