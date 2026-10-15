'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Theme } from '../../lib/types/theme';
import type { SongSubmissionView, SubmissionStatus } from '../../lib/types/submission';

// ===== 投稿審核 =====
// 玩家在 /submit 投稿的 YouTube 影片會先存成「待審核」，在這裡檢視影片、確認歌名／歌手、
// 補主題後才加入題庫（建立 Song）。重複性檢查以「目前題庫」即時重算，
// 投稿之後題庫又新增同一首歌時，這裡會看到最新的警告。

type Counts = Record<SubmissionStatus, number>;
const EMPTY_COUNTS: Counts = { pending: 0, approved: 0, rejected: 0 };
const TAB_LABEL: Record<SubmissionStatus, string> = { pending: '待審核', approved: '已通過', rejected: '已退回' };

const fieldStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid var(--groove)',
  background: 'var(--bg-raised)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-body)',
  fontSize: '0.95rem',
  minHeight: '44px',
  width: '100%',
};

function formatDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface CardProps {
  sub: SongSubmissionView;
  themes: Theme[];
  busy: boolean;
  onApprove: (sub: SongSubmissionView, fields: { title: string; artistName: string; themeIds: string[] }) => void;
  onReject: (sub: SongSubmissionView, reviewNote: string) => void;
  onReopen: (sub: SongSubmissionView) => void;
  onDelete: (sub: SongSubmissionView) => void;
}

function SubmissionCard({ sub, themes, busy, onApprove, onReject, onReopen, onDelete }: CardProps) {
  const [title, setTitle] = useState(sub.title);
  const [artist, setArtist] = useState(sub.artistName);
  const [themeIds, setThemeIds] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const report = sub.report;
  const videoDup = report?.reasons.some((r) => r.code === 'library-video') ?? false;
  const hasIssue = (report?.level ?? 'none') !== 'none';
  const isPending = sub.status === 'pending';

  return (
    <li
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px',
        borderRadius: '10px',
        border: `1px solid ${report?.level === 'block' ? 'var(--error)' : report?.level === 'warn' ? 'var(--accent)' : 'var(--groove)'}`,
      }}
    >
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- 外部縮圖 */}
        <img
          src={sub.thumbnailUrl}
          alt=""
          width={112}
          height={63}
          loading="lazy"
          style={{ width: '112px', height: '63px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0, background: 'var(--groove)' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{sub.videoTitle}</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
            {sub.channelTitle}・{formatDuration(sub.durationSec)}
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
            投稿者「{sub.submitterName}」・{formatDate(sub.createdAt)}
          </span>
          <button
            type="button"
            aria-expanded={previewing}
            onClick={() => setPreviewing((v) => !v)}
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: 'flex-start', minHeight: '44px' }}
          >
            {previewing ? '收起影片' : '預覽影片'}
          </button>
        </div>
      </div>

      {previewing && (
        <div style={{ position: 'relative', width: '100%', maxWidth: '480px', aspectRatio: '16 / 9', borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
          <iframe
            title={`預覽：${sub.videoTitle}`}
            src={`https://www.youtube-nocookie.com/embed/${sub.youtubeVideoId}?rel=0`}
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        </div>
      )}

      {sub.note && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ink)', lineHeight: 1.5 }}>
          <span style={{ color: 'var(--ink-dim)' }}>投稿備註：</span>
          {sub.note}
        </p>
      )}

      {isPending && report && hasIssue && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {report.reasons.map((r, i) => (
            <li
              key={`${r.code}-${i}`}
              style={{ fontSize: '0.82rem', lineHeight: 1.5, color: r.level === 'block' ? 'var(--error)' : 'var(--accent)' }}
            >
              {r.level === 'block' ? '重複：' : '注意：'}
              {r.message}
              {r.match && <span style={{ color: 'var(--ink-dim)' }}>（{r.match.artist}－{r.match.title}）</span>}
            </li>
          ))}
        </ul>
      )}
      {isPending && report && !hasIssue && (
        <span style={{ fontSize: '0.82rem', color: 'var(--success)' }}>題庫目前沒有重複</span>
      )}

      {sub.status === 'rejected' && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
          退回原因：{sub.reviewNote || '（未填寫）'}
          {sub.reviewedAt && `・${formatDate(sub.reviewedAt)}`}
        </p>
      )}
      {sub.status === 'approved' && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--success)' }}>
          已加入題庫：{sub.artistName}－{sub.title}
          {sub.reviewedAt && `・${formatDate(sub.reviewedAt)}`}
        </p>
      )}

      {isPending && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
              歌名
              <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
              歌手
              <input value={artist} maxLength={60} onChange={(e) => setArtist(e.target.value)} style={fieldStyle} />
            </label>
          </div>

          {themes.length > 0 && (
            <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
              <legend style={{ float: 'left', fontSize: '0.78rem', color: 'var(--ink-dim)', marginRight: '8px', padding: 0 }}>主題（選填）</legend>
              {themes.map((t) => {
                const on = themeIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setThemeIds((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                    className={`btn btn-toggle btn-sm${on ? ' is-active' : ''}`}
                    style={{ minHeight: '36px' }}
                  >
                    {t.name}
                  </button>
                );
              })}
            </fieldset>
          )}

          {rejecting ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.78rem', color: 'var(--ink-dim)', flex: '1 1 220px' }}>
                退回原因（選填，之後同一支影片再被投稿時會顯示）
                <input
                  value={reason}
                  maxLength={200}
                  autoFocus
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onReject(sub, reason);
                  }}
                  placeholder="例如：非原曲、音質太差、不適合題庫"
                  style={fieldStyle}
                />
              </label>
              <button type="button" disabled={busy} onClick={() => onReject(sub, reason)} className="btn btn-danger btn-sm" style={{ minHeight: '44px' }}>
                確定退回
              </button>
              <button type="button" onClick={() => setRejecting(false)} className="btn btn-ghost btn-sm" style={{ minHeight: '44px' }}>
                取消
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={busy || videoDup || !title.trim() || !artist.trim()}
                onClick={() => onApprove(sub, { title: title.trim(), artistName: artist.trim(), themeIds })}
                className="btn btn-primary btn-sm"
                style={{ minHeight: '44px' }}
              >
                {hasIssue && !videoDup ? '仍要加入題庫' : '通過並加入題庫'}
              </button>
              <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="btn btn-ghost btn-sm" style={{ minHeight: '44px' }}>
                退回
              </button>
            </div>
          )}
        </>
      )}

      {!isPending && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {sub.status === 'rejected' && (
            <button type="button" disabled={busy} onClick={() => onReopen(sub)} className="btn btn-ghost btn-sm" style={{ minHeight: '44px' }}>
              重新審核
            </button>
          )}
          {confirmDelete ? (
            <>
              <span style={{ fontSize: '0.82rem', color: 'var(--ink-dim)' }}>刪除這筆紀錄？（不影響已加入的歌曲）</span>
              <button type="button" disabled={busy} onClick={() => onDelete(sub)} className="btn btn-danger btn-sm" style={{ minHeight: '44px' }}>
                確定刪除
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-ghost btn-sm" style={{ minHeight: '44px' }}>
                取消
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="btn btn-danger btn-sm" style={{ minHeight: '44px' }}>
              刪除紀錄
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function SubmissionReviewAccordion({
  themes,
  onChanged,
  onError,
  onNotice,
}: {
  themes: Theme[];
  onChanged: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SubmissionStatus>('pending');
  const [items, setItems] = useState<SongSubmissionView[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const autoOpened = useRef(false);
  const seq = useRef(0);

  const load = useCallback(
    async (status: SubmissionStatus) => {
      const mySeq = ++seq.current;
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/submissions?status=${status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { submissions: SongSubmissionView[]; counts: Counts };
        if (mySeq !== seq.current) return;
        setItems(data.submissions);
        setCounts(data.counts);
        // 有待審核投稿時，第一次載入完自動展開，不用站長自己記得來看
        if (!autoOpened.current && data.counts.pending > 0) {
          autoOpened.current = true;
          setOpen(true);
        }
      } catch {
        if (mySeq === seq.current) onError('讀取投稿清單失敗');
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 載入外部資料（投稿清單）
    load(tab);
  }, [tab, load]);

  async function act(sub: SongSubmissionView, body: Record<string, unknown>, successMsg: string) {
    if (busyId) return;
    setBusyId(sub.id);
    try {
      const res = await fetch(`/api/admin/submissions/${encodeURIComponent(sub.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(typeof data.error === 'string' ? data.error : '操作失敗');
        return;
      }
      onNotice(successMsg);
      if (body.action === 'approve') onChanged();
      await load(tab);
    } catch {
      onError('網路錯誤，請稍後再試');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(sub: SongSubmissionView) {
    if (busyId) return;
    setBusyId(sub.id);
    try {
      const res = await fetch(`/api/admin/submissions/${encodeURIComponent(sub.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        onError('刪除失敗');
        return;
      }
      onNotice('已刪除投稿紀錄');
      await load(tab);
    } catch {
      onError('網路錯誤，請稍後再試');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ border: `1px solid ${counts.pending > 0 ? 'var(--accent)' : 'var(--groove)'}`, borderRadius: '10px', overflow: 'hidden' }}>
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
          minHeight: '48px',
        }}
      >
        <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          玩家投稿審核
          {counts.pending > 0 && (
            <span
              aria-label={`${counts.pending} 筆待審核`}
              style={{ fontSize: '0.75rem', fontWeight: 700, padding: '1px 9px', borderRadius: '999px', background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              {counts.pending}
            </span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
          {open ? '收合' : '展開'}
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
            <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--groove)' }}>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', margin: 0 }}>
            玩家從首頁「投稿題目」送出的 YouTube 影片。通過後以 YouTube 為來源加入題庫，之後可用下方「批次比對」補上 Apple Music／Deezer 來源。
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
            {loading && items.length === 0 ? (
              <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>載入中…</span>
            ) : items.length === 0 ? (
              <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
                {tab === 'pending' ? '目前沒有待審核的投稿' : `沒有${TAB_LABEL[tab]}的紀錄`}
              </span>
            ) : null}
          </div>

          {items.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '720px', overflowY: 'auto', overscrollBehavior: 'contain' }}>
              {items.map((sub) => (
                <SubmissionCard
                  key={sub.id}
                  sub={sub}
                  themes={themes}
                  busy={busyId !== null}
                  onApprove={(s, f) => act(s, { action: 'approve', ...f }, `已加入題庫：${f.artistName}－${f.title}`)}
                  onReject={(s, reviewNote) => act(s, { action: 'reject', reviewNote }, '已退回投稿')}
                  onReopen={(s) => act(s, { action: 'reopen' }, '已改回待審核')}
                  onDelete={remove}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
