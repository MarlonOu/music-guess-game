'use client';

import { useEffect, useRef, useState } from 'react';
import { PageShell } from '../../components/layout/PageShell';
import { submissionRepository } from '../../lib/repository/submissionRepository';
import { extractYoutubeVideoId } from '../../lib/engine/youtubeUrl';
import { PLAYER_NAME_STORAGE_KEY } from '../../lib/constants/streak';
import type { DuplicateReport, SubmissionCheckResponse } from '../../lib/types/submission';

type Phase = 'input' | 'checking' | 'ready' | 'submitting' | 'done';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Icon({ kind }: { kind: 'ok' | 'warn' | 'block' }) {
  const common = { width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true } as const;
  if (kind === 'ok')
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.6" />
        <path d="m6.3 10.3 2.5 2.5 4.9-5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === 'warn')
    return (
      <svg {...common}>
        <path d="M10 2.8 18 16.5H2L10 2.8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M10 8v3.8M10 14.1v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7 7 6 6M13 7l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const LEVEL_COLOR = { ok: 'var(--success)', warn: 'var(--accent)', block: 'var(--error)' } as const;

function ReportPanel({ report }: { report: DuplicateReport }) {
  const kind = report.level === 'none' ? 'ok' : report.level;
  const color = LEVEL_COLOR[kind];
  const heading =
    report.level === 'none'
      ? '題庫目前沒有這首歌，可以投稿'
      : report.level === 'warn'
        ? '可能有重複，請確認後再送出'
        : '這首歌無法投稿';
  return (
    <div
      role={report.level === 'block' ? 'alert' : 'status'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '14px 16px',
        borderRadius: '12px',
        border: `1px solid ${color}`,
        background: 'var(--bg-raised)',
      }}
    >
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color, fontWeight: 600, fontSize: '0.95rem' }}>
        <Icon kind={kind} />
        {heading}
      </div>
      {report.reasons.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {report.reasons.map((r, i) => (
            <li key={`${r.code}-${i}`} style={{ fontSize: '0.88rem', lineHeight: 1.55, color: 'var(--ink)' }}>
              {r.message}
              {r.match && (
                <span style={{ display: 'block', color: 'var(--ink-dim)', fontSize: '0.82rem', marginTop: '2px' }}>
                  對應：{r.match.artist}－{r.match.title}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SubmitPage() {
  const [phase, setPhase] = useState<Phase>('input');
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionCheckResponse | null>(null);
  const [report, setReport] = useState<DuplicateReport | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [ack, setAck] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const checkSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 從 localStorage 帶入上次使用的暱稱
      if (saved) setName(saved);
    } catch {
      // 讀不到就維持空白
    }
  }, []);

  async function runCheck(rawUrl: string) {
    const input = rawUrl.trim();
    if (!input) {
      setUrlError('請貼上 YouTube 影片網址');
      return;
    }
    if (!extractYoutubeVideoId(input)) {
      setUrlError('無法辨識這個網址。請貼上 YouTube 單一影片的網址（播放清單網址不適用）');
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const seq = ++checkSeq.current;
    setUrlError(null);
    setPhase('checking');
    const r = await submissionRepository.check({ url: input }, ctrl.signal);
    if (seq !== checkSeq.current) return;
    if (!r.ok || !r.data) {
      setUrlError(r.error ?? '檢查失敗');
      setPhase('input');
      return;
    }
    setResult(r.data);
    setReport(r.data.report);
    setTitle(r.data.suggestion.title);
    setArtist(r.data.suggestion.artist);
    setAck(false);
    setFormError(null);
    setPreviewing(false);
    setPhase('ready');
    requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: false }));
  }

  // 修改歌名／歌手後重新比對（停止輸入 600ms 才送出），警告會跟著最新內容更新
  useEffect(() => {
    if (phase !== 'ready' || !result) return;
    const t = title.trim();
    const a = artist.trim();
    if (!t || !a) return;
    const seq = ++checkSeq.current;
    const handle = setTimeout(async () => {
      setRechecking(true);
      const r = await submissionRepository.check({ url, title: t, artist: a });
      if (seq !== checkSeq.current) return;
      setRechecking(false);
      if (r.ok && r.data) {
        setReport(r.data.report);
        setAck(false);
      }
    }, 600);
    return () => {
      clearTimeout(handle);
      setRechecking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在玩家編輯歌名／歌手時重查
  }, [title, artist]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase !== 'ready' || !report || report.level === 'block') return;
    if (!title.trim() || !artist.trim()) {
      setFormError('請填寫歌名與歌手');
      return;
    }
    if (!name.trim()) {
      setFormError('請填寫暱稱，審核後會顯示是誰推薦的');
      return;
    }
    if (report.level === 'warn' && !ack) {
      setFormError('請先勾選「我確認這是不同的歌」');
      return;
    }
    setFormError(null);
    setPhase('submitting');
    try {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name.trim());
    } catch {
      // 存不了就只用這一次
    }
    const r = await submissionRepository.submit({
      url,
      title: title.trim(),
      artist: artist.trim(),
      note: note.trim(),
      submitterName: name.trim(),
      acknowledgeWarning: ack,
    });
    if (!r.ok) {
      if (r.report) setReport(r.report);
      setFormError(r.error ?? '送出失敗');
      setPhase('ready');
      return;
    }
    setDoneCount((n) => n + 1);
    setPhase('done');
  }

  function reset() {
    abortRef.current?.abort();
    checkSeq.current += 1;
    setPhase('input');
    setUrl('');
    setResult(null);
    setReport(null);
    setTitle('');
    setArtist('');
    setNote('');
    setAck(false);
    setFormError(null);
    setUrlError(null);
    setPreviewing(false);
    requestAnimationFrame(() => urlRef.current?.focus());
  }

  const checking = phase === 'checking';
  const blocked = report?.level === 'block';
  const showForm = (phase === 'ready' || phase === 'submitting') && result && report;

  return (
    <PageShell title="投稿題目" subtitle="推薦你想在遊戲裡聽到的歌。貼上 YouTube 網址，系統會先檢查題庫有沒有重複，通過管理者審核後加入題庫。" width={520}>
      {phase === 'done' ? (
        <div
          role="status"
          style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '20px', borderRadius: '14px', border: '1px solid var(--success)', background: 'var(--bg-raised)' }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--success)', fontWeight: 600 }}>
            <Icon kind="ok" />
            已送出，等待審核
          </div>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', lineHeight: 1.6 }}>
            「{artist}－{title}」已進入審核。通過後會自動出現在題庫，不需要再做任何事。
            {doneCount > 1 && `（這次已投稿 ${doneCount} 首，謝謝你！）`}
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={reset} autoFocus>
            再投稿一首
          </button>
        </div>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runCheck(url);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            noValidate
          >
            <label htmlFor="submit-url" style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
              YouTube 影片網址
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                id="submit-url"
                ref={urlRef}
                className="field"
                type="url"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                disabled={checking || phase === 'submitting'}
                aria-invalid={Boolean(urlError)}
                aria-describedby={urlError ? 'submit-url-error' : undefined}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (urlError) setUrlError(null);
                  // 改了網址就作廢目前的檢查結果，避免拿舊影片的資料送出
                  if (phase === 'ready') {
                    checkSeq.current += 1;
                    setPhase('input');
                    setResult(null);
                    setReport(null);
                  }
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (extractYoutubeVideoId(text)) {
                    e.preventDefault();
                    setUrl(text.trim());
                    runCheck(text);
                  }
                }}
                style={{ flex: '1 1 240px', minWidth: 0, minHeight: '48px' }}
              />
              <button type="submit" className="btn btn-secondary" disabled={checking || phase === 'submitting' || !url.trim()} style={{ minHeight: '48px' }}>
                {checking ? '檢查中…' : '檢查'}
              </button>
            </div>
            <div aria-live="polite" id="submit-url-error" style={{ minHeight: '1.2em', fontSize: '0.85rem', color: 'var(--error)' }}>
              {urlError}
            </div>
          </form>

          {checking && (
            <div role="status" aria-live="polite" style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
              正在查詢影片並比對題庫…
            </div>
          )}

          {showForm && (
            <div ref={resultRef} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid var(--groove)',
                  background: 'var(--bg-raised)',
                  alignItems: 'flex-start',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 外部縮圖，不需要 next/image 最佳化 */}
                <img
                  src={result.video.thumbnailUrl}
                  alt=""
                  width={120}
                  height={68}
                  loading="lazy"
                  style={{ width: '120px', height: '68px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0, background: 'var(--groove)' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '0.92rem', fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{result.video.title}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                    {result.video.channelTitle}・{formatDuration(result.video.durationSec)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ alignSelf: 'flex-start', minHeight: '44px', marginTop: '2px' }}
                    aria-expanded={previewing}
                    onClick={() => setPreviewing((v) => !v)}
                  >
                    {previewing ? '收起影片' : '預覽影片'}
                  </button>
                </div>
              </div>

              {previewing && (
                <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: '12px', overflow: 'hidden', background: '#000' }}>
                  <iframe
                    title="影片預覽"
                    src={`https://www.youtube-nocookie.com/embed/${result.video.videoId}?rel=0`}
                    allow="encrypted-media; picture-in-picture"
                    allowFullScreen
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                  />
                </div>
              )}

              <ReportPanel report={report} />

              {!blocked ? (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} noValidate>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label htmlFor="submit-title" style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
                      歌名
                    </label>
                    <input
                      id="submit-title"
                      ref={titleRef}
                      className="field"
                      value={title}
                      maxLength={100}
                      onChange={(e) => setTitle(e.target.value)}
                      style={{ minHeight: '48px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label htmlFor="submit-artist" style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
                      歌手
                    </label>
                    <input
                      id="submit-artist"
                      className="field"
                      value={artist}
                      maxLength={60}
                      onChange={(e) => setArtist(e.target.value)}
                      style={{ minHeight: '48px' }}
                    />
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
                      系統依影片標題自動帶入，請確認是否正確；改完會自動重新比對題庫{rechecking ? '（比對中…）' : ''}。
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label htmlFor="submit-note" style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
                      備註（選填）
                    </label>
                    <textarea
                      id="submit-note"
                      className="field"
                      rows={2}
                      maxLength={200}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="例如：這是現場版、想推薦的原因"
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label htmlFor="submit-name" style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
                      暱稱
                    </label>
                    <input
                      id="submit-name"
                      className="field"
                      value={name}
                      maxLength={20}
                      autoComplete="nickname"
                      onChange={(e) => setName(e.target.value)}
                      style={{ minHeight: '48px' }}
                    />
                  </div>

                  {report.level === 'warn' && (
                    <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '0.9rem', lineHeight: 1.5, minHeight: '44px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                        style={{ width: '20px', height: '20px', marginTop: '2px', accentColor: 'var(--accent)', flexShrink: 0 }}
                      />
                      我確認這是不同的歌，仍要投稿
                    </label>
                  )}

                  <div aria-live="polite" style={{ minHeight: '1.2em', fontSize: '0.85rem', color: 'var(--error)' }}>
                    {formError}
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary btn-block"
                    disabled={phase === 'submitting' || rechecking}
                    style={{ minHeight: '52px' }}
                  >
                    {phase === 'submitting' ? '送出中…' : '送出投稿'}
                  </button>
                </form>
              ) : (
                <button type="button" className="btn btn-secondary btn-block" onClick={reset} style={{ minHeight: '52px' }}>
                  改投稿其他影片
                </button>
              )}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
