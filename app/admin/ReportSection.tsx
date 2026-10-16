'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  REPORT_CATEGORY_LABEL,
  type ClientLogEntry,
  type ErrorReportSummary,
  type LogPrimitive,
  type LogType,
  type ReportCategory,
  type ReportStatus,
} from '../../lib/types/report';
import { dangerButtonStyle, editButtonStyle, sectionStyle } from './adminShared';

// ===== 使用者回報處理（管理頁最下方）=====
// 每筆回報附帶自動收集的操作紀錄與裝置資訊；列表只載入摘要，展開時才載入完整時間軸。

type Counts = Record<ReportStatus, number>;
const EMPTY_COUNTS: Counts = { open: 0, resolved: 0, ignored: 0 };
const TAB_LABEL: Record<ReportStatus, string> = { open: '未處理', resolved: '已處理', ignored: '已忽略' };
const TYPE_LABEL: Record<LogType, string> = {
  nav: '頁面', click: '點擊', net: '請求', audio: '音訊', console: '主控台', error: '錯誤', game: '遊戲', env: '環境',
};

interface ReportView extends ErrorReportSummary {
  env: Record<string, LogPrimitive>;
}

function parseUserAgent(ua: string): string {
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '未知系統';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /(CriOS|Chrome)\//.test(ua)
      ? 'Chrome'
      : /(FxiOS|Firefox)\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '未知瀏覽器';
  return `${os}・${browser}`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 相對於回報送出時間：-12.3s 代表送出前 12.3 秒 */
function relative(entryT: number, reportedAt: number | undefined): string {
  if (!reportedAt) return formatClock(entryT);
  const diff = (entryT - reportedAt) / 1000;
  return `${diff >= 0 ? '+' : '-'}${Math.abs(diff).toFixed(1)}s`;
}

function logsToText(report: ReportView, logs: ClientLogEntry[]): string {
  const reportedAt = typeof report.env.reportedAt === 'number' ? report.env.reportedAt : undefined;
  const head = [
    `回報 ${report.id}`,
    `類型：${REPORT_CATEGORY_LABEL[report.category as ReportCategory] ?? report.category}`,
    `頁面：${report.route}`,
    `說明：${report.message}`,
    `裝置：${report.userAgent}`,
    `環境：${JSON.stringify(report.env)}`,
    '',
  ];
  const lines = logs.map((l) => {
    const data = l.data ? ` ${JSON.stringify(l.data)}` : '';
    return `${formatClock(l.t)} (${relative(l.t, reportedAt)}) [${l.type}${l.lvl ? `/${l.lvl}` : ''}] ${l.msg}${data}`;
  });
  return [...head, ...lines].join('\n');
}

export function ReportSection({
  onError,
  onNotice,
}: {
  onError: (message: string | null) => void;
  onNotice: (message: string) => void;
}) {
  const [tab, setTab] = useState<ReportStatus>('open');
  const [reports, setReports] = useState<ReportView[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const load = useCallback(
    async (status: ReportStatus) => {
      try {
        const res = await fetch(`/api/admin/reports?status=${status}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '讀取回報失敗');
        setReports(data.reports);
        setCounts({ ...EMPTY_COUNTS, ...data.counts });
      } catch (err) {
        onError(err instanceof Error ? err.message : '讀取回報失敗');
      } finally {
        setLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 載入外部資料（回報清單）
    load(tab);
  }, [tab, load]);

  function changeTab(next: ReportStatus) {
    if (next === tab) return;
    setLoading(true);
    setExpanded(null);
    setConfirmDelete(null);
    setConfirmBulk(false);
    setTab(next);
  }

  async function updateReport(id: string, patch: { status?: ReportStatus; adminNote?: string }, notice?: string) {
    try {
      const res = await fetch(`/api/admin/reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '更新失敗');
      if (notice) onNotice(notice);
      await load(tab);
    } catch (err) {
      onError(err instanceof Error ? err.message : '更新失敗');
    }
  }

  async function removeReport(id: string) {
    try {
      const res = await fetch(`/api/admin/reports/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '刪除失敗');
      setConfirmDelete(null);
      onNotice('已刪除回報');
      await load(tab);
    } catch (err) {
      onError(err instanceof Error ? err.message : '刪除失敗');
    }
  }

  async function clearTab() {
    if (tab === 'open') return;
    try {
      const res = await fetch(`/api/admin/reports?status=${tab}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '清除失敗');
      setConfirmBulk(false);
      onNotice(`已清除 ${data.deleted} 筆${TAB_LABEL[tab]}回報`);
      await load(tab);
    } catch (err) {
      onError(err instanceof Error ? err.message : '清除失敗');
    }
  }

  return (
    <section style={sectionStyle} aria-labelledby="report-heading">
      <h2 id="report-heading" style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
        使用者回報
        {counts.open > 0 && (
          <span
            aria-label={`${counts.open} 筆未處理`}
            style={{ background: 'var(--error)', color: '#fff', borderRadius: '999px', padding: '2px 10px', fontSize: '0.8rem' }}
          >
            {counts.open}
          </span>
        )}
      </h2>

      <div role="tablist" aria-label="回報狀態" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {(Object.keys(TAB_LABEL) as ReportStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={tab === s}
            onClick={() => changeTab(s)}
            style={{
              ...editButtonStyle,
              minHeight: '44px',
              ...(tab === s ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : {}),
            }}
          >
            {TAB_LABEL[s]}（{counts[s]}）
          </button>
        ))}
        {tab !== 'open' && counts[tab] > 0 && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            {confirmBulk ? (
              <>
                <button type="button" style={{ ...dangerButtonStyle, minHeight: '44px' }} onClick={clearTab}>
                  確認清除 {counts[tab]} 筆
                </button>
                <button type="button" style={{ ...editButtonStyle, minHeight: '44px' }} onClick={() => setConfirmBulk(false)}>
                  取消
                </button>
              </>
            ) : (
              <button type="button" style={{ ...dangerButtonStyle, minHeight: '44px' }} onClick={() => setConfirmBulk(true)}>
                全部清除
              </button>
            )}
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--ink-dim)' }}>讀取中…</p>
      ) : reports.length === 0 ? (
        <p style={{ color: 'var(--ink-dim)' }}>沒有{TAB_LABEL[tab]}的回報</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {reports.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              expanded={expanded === r.id}
              onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
              confirmingDelete={confirmDelete === r.id}
              onAskDelete={() => setConfirmDelete(r.id)}
              onCancelDelete={() => setConfirmDelete(null)}
              onDelete={() => removeReport(r.id)}
              onStatus={(status) =>
                updateReport(r.id, { status }, status === 'resolved' ? '已標記為已處理' : status === 'ignored' ? '已忽略' : '已重新開啟')
              }
              onNote={(adminNote) => updateReport(r.id, { adminNote }, '已儲存備註')}
              onError={onError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportCard({
  report,
  expanded,
  onToggle,
  confirmingDelete,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onStatus,
  onNote,
  onError,
}: {
  report: ReportView;
  expanded: boolean;
  onToggle: () => void;
  confirmingDelete: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onStatus: (status: ReportStatus) => void;
  onNote: (note: string) => void;
  onError: (message: string | null) => void;
}) {
  const [logs, setLogs] = useState<ClientLogEntry[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'issues'>('all');
  const [note, setNote] = useState(report.adminNote);
  const [copied, setCopied] = useState(false);
  const env = report.env;
  const reportedAt = typeof env.reportedAt === 'number' ? env.reportedAt : undefined;

  useEffect(() => {
    if (!expanded || logs) return;
    let cancelled = false;
    fetch(`/api/admin/reports/${report.id}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '讀取紀錄失敗');
        if (!cancelled) setLogs(Array.isArray(data.logs) ? data.logs : []);
      })
      .catch((err) => {
        if (!cancelled) onError(err instanceof Error ? err.message : '讀取紀錄失敗');
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, logs, report.id, onError]);

  const visibleLogs = useMemo(() => {
    if (!logs) return [];
    return filter === 'issues' ? logs.filter((l) => l.lvl || l.type === 'error') : logs;
  }, [logs, filter]);

  async function copyAll() {
    if (!logs) return;
    try {
      await navigator.clipboard.writeText(logsToText(report, logs));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError('無法複製到剪貼簿');
    }
  }

  const deviceBits = [
    parseUserAgent(report.userAgent),
    env.viewport ? `視窗 ${env.viewport}` : '',
    env.connection ? `網路 ${env.connection}` : '',
    env.standalone ? 'PWA' : '',
  ].filter(Boolean);

  return (
    <li style={{ border: '1px solid var(--groove)', borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
        <span style={{ border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '999px', padding: '2px 10px' }}>
          {REPORT_CATEGORY_LABEL[report.category as ReportCategory] ?? report.category}
        </span>
        <span>{formatDateTime(report.createdAt)}</span>
        {report.errorCount > 0 && (
          <span style={{ color: 'var(--error)' }}>含 {report.errorCount} 筆錯誤</span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          {report.nickname || '匿名'}
          {report.contact ? `・${report.contact}` : ''}
        </span>
      </div>

      <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{report.message}</p>

      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink-dim)', wordBreak: 'break-word' }}>
        {report.route}・{deviceBits.join('・')}
      </p>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ ...editButtonStyle, minHeight: '44px', alignSelf: 'flex-start' }}
      >
        {expanded ? '收合操作紀錄' : `查看操作紀錄（${report.logCount} 筆）`}
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {!logs ? (
            <p style={{ color: 'var(--ink-dim)', margin: 0 }}>讀取中…</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  aria-pressed={filter === 'issues'}
                  onClick={() => setFilter(filter === 'all' ? 'issues' : 'all')}
                  style={{ ...editButtonStyle, minHeight: '44px', ...(filter === 'issues' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}
                >
                  只看錯誤／警告
                </button>
                <button type="button" onClick={copyAll} style={{ ...editButtonStyle, minHeight: '44px' }}>
                  {copied ? '已複製' : '複製全部'}
                </button>
              </div>

              <details style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                <summary style={{ cursor: 'pointer', minHeight: '32px' }}>完整環境資訊</summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '6px 0 0', fontFamily: 'var(--font-mono, monospace)' }}>
                  {report.userAgent + '\n' + JSON.stringify(env, null, 2)}
                </pre>
              </details>

              <ol
                style={{
                  listStyle: 'none', margin: 0, padding: '8px', maxHeight: '360px', overflowY: 'auto',
                  border: '1px solid var(--groove)', borderRadius: '8px', background: 'var(--bg)',
                  fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', lineHeight: 1.5,
                }}
              >
                {visibleLogs.length === 0 && <li style={{ color: 'var(--ink-dim)' }}>沒有符合的紀錄</li>}
                {visibleLogs.map((l, i) => {
                  const color = l.lvl === 'e' || l.type === 'error' ? 'var(--error)' : l.lvl === 'w' ? '#e0a53a' : 'var(--ink)';
                  return (
                    <li key={i} style={{ display: 'flex', gap: '8px', padding: '2px 0', color }}>
                      <span style={{ flex: '0 0 56px', textAlign: 'right', color: 'var(--ink-dim)' }}>{relative(l.t, reportedAt)}</span>
                      <span style={{ flex: '0 0 44px', color: 'var(--ink-dim)' }}>{TYPE_LABEL[l.type] ?? l.type}</span>
                      <span style={{ wordBreak: 'break-word', minWidth: 0 }}>
                        {l.msg}
                        {l.data && <span style={{ color: 'var(--ink-dim)' }}> {JSON.stringify(l.data)}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
        <input
          aria-label="管理者備註"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="備註（處理方式、原因…）"
          style={{
            flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--groove)',
            background: 'var(--bg)', color: 'var(--ink)', fontSize: '0.9rem',
          }}
        />
        <button
          type="button"
          disabled={note === report.adminNote}
          onClick={() => onNote(note)}
          style={{ ...editButtonStyle, minHeight: '44px', opacity: note === report.adminNote ? 0.5 : 1 }}
        >
          儲存備註
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {report.status !== 'resolved' && (
          <button type="button" style={{ ...editButtonStyle, minHeight: '44px' }} onClick={() => onStatus('resolved')}>
            標記已處理
          </button>
        )}
        {report.status !== 'ignored' && (
          <button type="button" style={{ ...editButtonStyle, minHeight: '44px' }} onClick={() => onStatus('ignored')}>
            忽略
          </button>
        )}
        {report.status !== 'open' && (
          <button type="button" style={{ ...editButtonStyle, minHeight: '44px' }} onClick={() => onStatus('open')}>
            重新開啟
          </button>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {confirmingDelete ? (
            <>
              <button type="button" style={{ ...dangerButtonStyle, minHeight: '44px' }} onClick={onDelete}>確認刪除</button>
              <button type="button" style={{ ...editButtonStyle, minHeight: '44px' }} onClick={onCancelDelete}>取消</button>
            </>
          ) : (
            <button type="button" style={{ ...dangerButtonStyle, minHeight: '44px' }} onClick={onAskDelete}>刪除</button>
          )}
        </span>
      </div>
    </li>
  );
}
