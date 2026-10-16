'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { collectEnvironment, getLogSnapshot, installGlobalCapture, logEvent } from '../../lib/client/clientLog';
import { OPEN_REPORT_EVENT, type OpenReportDetail } from '../../lib/client/reportBus';
import { PLAYER_NAME_STORAGE_KEY } from '../../lib/constants/streak';
import { REPORT_CATEGORIES, type ReportCategory } from '../../lib/types/report';

const MAX_MESSAGE = 1000;

type Phase = 'form' | 'sending' | 'done';

export default function ReportWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [category, setCategory] = useState<ReportCategory>('playback');
  const [message, setMessage] = useState('');
  const [nickname, setNickname] = useState('');
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const uid = useId();

  useEffect(() => {
    installGlobalCapture();
  }, []);

  const lastPathRef = useRef<string | null>(null);
  useEffect(() => {
    // 首次載入已由 installGlobalCapture 記錄，之後的路由切換才另外記錄
    if (lastPathRef.current !== null && lastPathRef.current !== pathname) logEvent('nav', `前往 ${pathname}`);
    lastPathRef.current = pathname;
  }, [pathname]);

  const openDialog = useCallback((detail?: OpenReportDetail) => {
    try {
      const saved = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
      if (saved) setNickname((prev) => prev || saved.slice(0, 20));
    } catch {
      // 讀不到就留空
    }
    if (detail?.category) setCategory(detail.category);
    if (detail?.prefill) setMessage((prev) => prev || detail.prefill || '');
    setPhase('form');
    setError(null);
    setOpen(true);
    logEvent('env', '開啟回報視窗');
  }, []);

  useEffect(() => {
    const handler = (e: Event) => openDialog((e as CustomEvent<OpenReportDetail>).detail);
    window.addEventListener(OPEN_REPORT_EVENT, handler);
    return () => window.removeEventListener(OPEN_REPORT_EVENT, handler);
  }, [openDialog]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // 開啟時：鎖定背景捲動、聚焦說明欄、Esc 關閉、Tab 焦點限制在視窗內
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = setTimeout(() => messageRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, input, select, [href]'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === 'sending') return;
    const text = message.trim();
    if (text.length < 3) {
      setError('請簡單描述發生了什麼事（至少 3 個字）');
      messageRef.current?.focus();
      return;
    }
    setError(null);
    setPhase('sending');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message: text,
          nickname: nickname.trim(),
          contact: contact.trim(),
          route: window.location.pathname,
          env: collectEnvironment(),
          logs: getLogSnapshot(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '送出失敗，請稍後再試');
      logEvent('env', '回報已送出');
      setMessage('');
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '送出失敗，請稍後再試');
      setPhase('form');
    }
  }

  if (pathname?.startsWith('/admin')) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="report-fab"
        onClick={() => openDialog()}
        aria-haspopup="dialog"
        aria-label="回報問題"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 22V4" />
          <path d="M4 4h13l-2 4 2 4H4" />
        </svg>
        <span className="report-fab-label">回報</span>
      </button>

      {open && (
        <div className="report-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div
            ref={dialogRef}
            className="report-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${uid}-title`}
          >
            <div className="report-head">
              <h2 id={`${uid}-title`}>回報問題</h2>
              <button type="button" className="report-close" onClick={close} aria-label="關閉">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {phase === 'done' ? (
              <div className="report-done" role="status">
                <p className="report-done-title">已收到回報</p>
                <p className="report-hint">問題會由管理者查看並處理，感謝你的協助。</p>
                <button type="button" className="btn btn-primary btn-block" onClick={close}>
                  關閉
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="report-form">
                <label className="report-label" htmlFor={`${uid}-cat`}>問題類型</label>
                <select
                  id={`${uid}-cat`}
                  className="field"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ReportCategory)}
                >
                  {REPORT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <p className="report-hint">{REPORT_CATEGORIES.find((c) => c.value === category)?.hint}</p>

                <label className="report-label" htmlFor={`${uid}-msg`}>發生了什麼事</label>
                <textarea
                  id={`${uid}-msg`}
                  ref={messageRef}
                  className="field report-textarea"
                  value={message}
                  maxLength={MAX_MESSAGE}
                  rows={4}
                  placeholder="例如：第二題一直轉圈沒有聲音，按重試也沒用"
                  onChange={(e) => setMessage(e.target.value)}
                />
                <p className="report-count">{message.length}/{MAX_MESSAGE}</p>

                <div className="report-row">
                  <div>
                    <label className="report-label" htmlFor={`${uid}-nick`}>暱稱（選填）</label>
                    <input
                      id={`${uid}-nick`}
                      className="field"
                      value={nickname}
                      maxLength={20}
                      onChange={(e) => setNickname(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="report-label" htmlFor={`${uid}-contact`}>聯絡方式（選填）</label>
                    <input
                      id={`${uid}-contact`}
                      className="field"
                      value={contact}
                      maxLength={100}
                      placeholder="Email 或 LINE"
                      onChange={(e) => setContact(e.target.value)}
                    />
                  </div>
                </div>

                <p className="report-disclosure">
                  送出時會自動附上最近的操作紀錄與裝置資訊（瀏覽器、螢幕大小、網路狀態），協助重現問題。不會包含你輸入的文字內容。
                </p>

                {error && <p className="report-error" role="alert">{error}</p>}

                <div className="report-actions">
                  <button type="button" className="btn btn-secondary" onClick={close}>取消</button>
                  <button type="submit" className="btn btn-primary" disabled={phase === 'sending'}>
                    {phase === 'sending' ? '送出中…' : '送出回報'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
