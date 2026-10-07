'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { PageShell } from '../../components/layout/PageShell';
import { StageDisc } from '../../components/game/StageDisc';
import { AnswerSticker } from '../../components/game/AnswerSticker';
import { LeaderboardList } from '../../components/game/LeaderboardList';
import { SongSearchInput } from '../../components/game/SongSearchInput';
import { getGlobalAudioController } from '../../lib/audio/globalAudioController';
import type { AudioController, AudioPlaybackStatus } from '../../lib/audio/audioController';
import { streakRepository } from '../../lib/repository/streakRepository';
import { useSongIndex } from '../../lib/client/useSongIndex';
import {
  STREAK_STAGES_SEC,
  STREAK_CLIP_SEC,
  STREAK_BEST_STORAGE_KEY,
  PLAYER_NAME_STORAGE_KEY,
  streakPointsForStage,
} from '../../lib/constants/streak';
import type {
  StreakAnswer,
  StreakLeaderboardEntry,
  StreakPlayback,
  StreakQuestion,
  StreakSubmitResponse,
} from '../../lib/types/streak';

type Phase = 'loading' | 'intro' | 'starting' | 'playing' | 'revealed' | 'submitting' | 'results';

const LAST_STAGE = STREAK_STAGES_SEC.length - 1;

const STATUS_LABEL: Record<AudioPlaybackStatus, string> = {
  idle: '點中間開始播放',
  loading: '載入中…',
  playing: '播放中',
  paused: '已暫停',
  finished: '播放完畢，可再聽一次',
  error: '播放失敗，點中間重試',
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s　]+/g, '');
}

function PlayIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4.5" height="14" rx="1.2" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="1.2" />
    </svg>
  );
}

const inputStyle = {
  padding: '12px 16px',
  borderRadius: '10px',
  border: '1px solid var(--groove)',
  background: 'var(--bg-raised)',
  color: 'var(--ink)',
  fontSize: '1rem',
} as const;
const buttonStyle = {
  padding: '13px 22px',
  borderRadius: '10px',
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  fontWeight: 600,
  fontSize: '0.95rem',
} as const;
const secondaryButtonStyle = {
  padding: '13px 22px',
  borderRadius: '10px',
  border: '1px solid var(--accent)',
  background: 'transparent',
  color: 'var(--accent)',
  fontWeight: 600,
  fontSize: '0.95rem',
} as const;

function formatEntry(e: { streak: number; score: number }) {
  return `${e.streak} 連勝 · ${e.score} 分`;
}

export default function StreakPage() {
  const reduce = useReducedMotion();
  const songIndex = useSongIndex();
  const [controller, setController] = useState<AudioController | null>(null);
  const [status, setStatus] = useState<AudioPlaybackStatus>('idle');
  const [playTick, setPlayTick] = useState(0);

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [question, setQuestion] = useState<StreakQuestion | null>(null);
  const [answer, setAnswer] = useState<StreakAnswer | null>(null);
  const [outcome, setOutcome] = useState<'correct' | 'failed' | null>(null);
  const [lastGain, setLastGain] = useState(0);
  const [streak, setStreak] = useState(0);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [covers, setCovers] = useState<Record<string, string | null>>({});

  const [results, setResults] = useState<StreakSubmitResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [introLeaderboard, setIntroLeaderboard] = useState<StreakLeaderboardEntry[] | null>(null);

  const [input, setInput] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  // 外部播放器（全域共用實例）與本機紀錄
  useEffect(() => {
    const c = getGlobalAudioController();
    c.setOnStatusChange(setStatus);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 連接外部共用播放器的合法例外
    setController(c);
    c.preload();
    try {
      const saved = Number(localStorage.getItem(STREAK_BEST_STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) setBest(saved);
      const name = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
      if (name) setDisplayName(name);
    } catch {
      // 隱私模式下讀不到就維持預設
    }
    setPhase('intro');
    return () => {
      c.setOnStatusChange(undefined);
      c.stop();
    };
  }, []);

  // 公布答案時抓封面（沿用單機模式的封面查詢，答案公布後才知道 songId）
  const revealedId = phase === 'revealed' ? answer?.songId : undefined;
  useEffect(() => {
    if (!revealedId || revealedId in covers) return;
    let cancelled = false;
    fetch(`/api/songs/${encodeURIComponent(revealedId)}/cover`)
      .then((r) => (r.ok ? r.json() : { coverUrl: null }))
      .catch(() => ({ coverUrl: null }))
      .then((data: { coverUrl: string | null }) => {
        if (!cancelled) setCovers((prev) => ({ ...prev, [revealedId]: data.coverUrl }));
      });
    return () => {
      cancelled = true;
    };
  }, [revealedId, covers]);

  function playPlayback(pb: StreakPlayback) {
    if (!controller) return;
    setPlayTick((t) => t + 1);
    controller.play(
      pb.source,
      pb.idOrUrl,
      pb.startSec,
      pb.durationSec > 0 ? pb.durationSec : undefined,
      pb.fallback
    );
  }

  function resetQuestionState() {
    setInput('');
    setPickedId(null);
    setAnswer(null);
    setOutcome(null);
  }

  // 伺服器請求的共用外殼：同一時間只處理一個請求，避免快速連點送出重複請求
  async function guarded<T>(fn: () => Promise<T>): Promise<T | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!controller || busyRef.current) return;
    const name = displayName.trim();
    if (!name) {
      setError('請先輸入暱稱，成績會用這個名字上榜');
      return;
    }
    try {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    } catch {
      // 存不了就只用這一次
    }
    setError(null);
    setPhase('starting');
    // 開始鍵是真正的使用者手勢，先解鎖播放器；之後每一段都由玩家自己按唱盤播放
    await controller.unlock();
    const result = await guarded(() => streakRepository.start());
    if (!result || !result.ok || !result.data) {
      setError(result?.error ?? '開始挑戰失敗');
      setPhase('intro');
      return;
    }
    setToken(result.data.token);
    setQuestion(result.data.question);
    setStreak(0);
    setScore(0);
    setResults(null);
    setSubmitError(null);
    resetQuestionState();
    setPhase('playing');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function showAnswer(a: StreakAnswer, result: 'correct' | 'failed', gain: number) {
    controller?.stop();
    setAnswer(a);
    setOutcome(result);
    setLastGain(gain);
    setPhase('revealed');
    // 公布答案後自動播放這首歌（猜測、放棄都是玩家剛剛的操作，瀏覽器允許出聲）
    if (a.reveal) playPlayback(a.reveal);
  }

  function recordBest(finalStreak: number) {
    if (finalStreak <= best) return;
    setBest(finalStreak);
    try {
      localStorage.setItem(STREAK_BEST_STORAGE_KEY, String(finalStreak));
    } catch {
      // 存不了就只在本次顯示
    }
  }

  async function handleGuess(e?: React.FormEvent) {
    e?.preventDefault();
    if (!token || !question || phase !== 'playing') return;
    const text = input.trim();
    if (!text) return;
    // 沒有從清單選取時，歌名完全相符就直接帶 songId；否則送自由文字讓伺服器比對
    let songId = pickedId;
    if (!songId) {
      const exact = songIndex.filter((s) => normalize(s.title) === normalize(text));
      if (exact.length === 1) songId = exact[0].id;
    }
    const result = await guarded(() => streakRepository.guess(token, songId ? { songId } : { text }));
    if (!result) return;
    if (!result.ok || !result.data) {
      setError(result.error ?? '判定失敗');
      return;
    }
    setError(null);
    const r = result.data;
    setStreak(r.streak);
    setScore(r.score);
    if (r.result === 'correct' && r.answer) {
      showAnswer(r.answer, 'correct', r.gain ?? 0);
      return;
    }
    if (r.result === 'failed' && r.answer) {
      recordBest(r.streak);
      showAnswer(r.answer, 'failed', 0);
      return;
    }
    if (r.question) {
      // 猜錯：解鎖下一段，停止目前播放，由玩家自己決定何時播放
      controller?.stop();
      setQuestion(r.question);
      setInput('');
      setPickedId(null);
      setShakeKey((k) => k + 1);
      inputRef.current?.focus();
    }
  }

  async function handleMore() {
    if (!token || !question || phase !== 'playing' || question.stage >= LAST_STAGE) return;
    const result = await guarded(() => streakRepository.skipStage(token));
    if (!result) return;
    if (!result.ok || !result.data) {
      setError(result.error ?? '操作失敗');
      return;
    }
    setError(null);
    controller?.stop();
    setQuestion(result.data);
  }

  async function handleGiveUp() {
    if (!token || phase !== 'playing') return;
    const result = await guarded(() => streakRepository.giveUp(token));
    if (!result) return;
    if (!result.ok || !result.data) {
      setError(result.error ?? '操作失敗');
      return;
    }
    recordBest(result.data.streak);
    setStreak(result.data.streak);
    setScore(result.data.score);
    showAnswer(result.data.answer, 'failed', 0);
  }

  async function handleNext() {
    if (!token || phase !== 'revealed' || outcome !== 'correct') return;
    const result = await guarded(() => streakRepository.next(token));
    if (!result) return;
    if (!result.ok || !result.data) {
      setError(result.error ?? '操作失敗');
      return;
    }
    controller?.stop();
    const r = result.data;
    if (r.over || !r.question) {
      // 題庫全部猜完，直接結算
      recordBest(r.streak);
      await submitScore(r.streak);
      return;
    }
    setError(null);
    resetQuestionState();
    setQuestion(r.question);
    setPhase('playing');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleEndRun() {
    if (!token || phase !== 'revealed' || outcome !== 'correct') return;
    const result = await guarded(() => streakRepository.end(token));
    if (!result) return;
    if (!result.ok || !result.data) {
      setError(result.error ?? '操作失敗');
      return;
    }
    recordBest(result.data.streak);
    await submitScore(result.data.streak);
  }

  async function submitScore(finalStreak: number = streak) {
    if (!token) return;
    controller?.stop();
    setPhase('submitting');
    setSubmitError(null);
    if (finalStreak <= 0) {
      // 一首都沒答對不上榜，直接顯示結果
      setResults({ streak: 0, score: 0, rank: 0, totalRuns: 0, scoreId: '', leaderboard: [] });
      setPhase('results');
      return;
    }
    const result = await streakRepository.submit(token, displayName.trim());
    if (!result.ok || !result.data) {
      setSubmitError(result.error ?? '送出成績失敗');
      return;
    }
    setResults(result.data);
    setPhase('results');
  }

  async function loadIntroLeaderboard() {
    if (introLeaderboard !== null) {
      setIntroLeaderboard(null);
      return;
    }
    const result = await streakRepository.getLeaderboard();
    if (result.ok && result.data) setIntroLeaderboard(result.data);
  }

  function handleRetry() {
    setPhase('intro');
    setResults(null);
    setToken(null);
    setQuestion(null);
    resetQuestionState();
    setError(null);
    setIntroLeaderboard(null);
  }

  function handleStageButton() {
    if (!controller || !question) return;
    if (status === 'playing') {
      controller.pause();
    } else if (status === 'paused') {
      controller.resume();
    } else {
      playPlayback(question.playback);
    }
  }

  function handleReplayReveal() {
    if (!controller || !answer?.reveal) return;
    if (status === 'playing') controller.pause();
    else if (status === 'paused') controller.resume();
    else playPlayback(answer.reveal);
  }

  const spinning = status === 'playing';
  const stage = question?.stage ?? 0;
  const wrong = question?.wrong ?? [];

  // ------------------------------------------------------------------ 畫面
  if (phase === 'loading') {
    return (
      <PageShell title="無限連勝" subtitle="準備中…">
        <div className="loading-disc" aria-hidden="true" />
      </PageShell>
    );
  }

  if (phase === 'intro' || phase === 'starting') {
    return (
      <PageShell
        title="無限連勝"
        subtitle={`隨機片段，最多只聽 ${STREAK_CLIP_SEC} 秒認得出幾首？一路連勝，直到猜錯為止。`}
        width={420}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}
        >
          <ol className="streak-rules">
            <li>
              <b>
                {STREAK_STAGES_SEC[0]} → {STREAK_CLIP_SEC} 秒
              </b>
              <span>
                每首歌從隨機片段開始，猜錯或按「多聽」就解鎖下一段：{STREAK_STAGES_SEC.join('、')} 秒。每一段都要自己按唱盤播放。
              </span>
            </li>
            <li>
              <b>越早猜中越高分</b>
              <span>
                各段答對依序得 {STREAK_STAGES_SEC.map((_, i) => streakPointsForStage(i)).join('、')} 分，越早猜中分數越高。
              </span>
            </li>
            <li>
              <b>連勝不斷線</b>
              <span>6 段都沒猜中或放棄公布答案，挑戰結束，成績依連勝首數與總分上榜。</span>
            </li>
          </ol>

          <div className="streak-best">
            <span>這台裝置的最佳連勝</span>
            <b>{best}</b>
          </div>

          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="輸入暱稱"
            maxLength={20}
            style={inputStyle}
          />
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem', textAlign: 'center' }}>{error}</p>}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleStart}
            disabled={phase === 'starting'}
            style={buttonStyle}
          >
            {phase === 'starting' ? '準備中…' : '開始挑戰'}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={loadIntroLeaderboard}
            style={{ ...secondaryButtonStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            {introLeaderboard !== null ? '收合排行榜' : '查看目前排行榜'}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              style={{
                transform: introLeaderboard !== null ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
          {introLeaderboard !== null && <LeaderboardList entries={introLeaderboard} formatValue={formatEntry} />}
        </motion.div>
      </PageShell>
    );
  }

  if (phase === 'submitting') {
    return (
      <PageShell title="結算中" width={420} showBack={false}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '24px 0' }}>
          {submitError ? (
            <>
              <p style={{ color: 'var(--error)', fontSize: '0.9rem', textAlign: 'center' }}>{submitError}</p>
              <button onClick={() => submitScore()} style={buttonStyle}>
                重新送出
              </button>
            </>
          ) : (
            <p style={{ color: 'var(--ink-dim)' }}>送出成績中…</p>
          )}
        </div>
      </PageShell>
    );
  }

  if (phase === 'results' && results) {
    const ranked = results.rank > 0;
    return (
      <PageShell title="挑戰結束" width={420}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', width: '100%' }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
          >
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>你的成績</p>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '2.2rem',
                fontWeight: 700,
                color: 'var(--accent)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {streak} 連勝
            </p>
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.95rem' }}>總分 {score}</p>
            {ranked ? (
              <p style={{ fontSize: '1.1rem' }}>
                全站第 <strong>{results.rank}</strong> 名（共 {results.totalRuns} 次挑戰）
              </p>
            ) : (
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>至少答對一首才能上榜</p>
            )}
          </motion.div>

          {ranked && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              style={{ width: '100%' }}
            >
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: '8px' }}>排行榜 Top 100</p>
              <LeaderboardList entries={results.leaderboard} highlightId={results.scoreId} formatValue={formatEntry} />
            </motion.div>
          )}

          <motion.button whileTap={{ scale: 0.97 }} onClick={handleRetry} style={buttonStyle}>
            再試一次
          </motion.button>
          <Link href="/" className="btn btn-ghost" style={{ textAlign: 'center' }}>
            回到首頁
          </Link>
        </motion.div>
      </PageShell>
    );
  }

  // playing / revealed
  const revealed = phase === 'revealed' && answer;
  const hasStarted = status !== 'idle';
  return (
    <PageShell title="無限連勝" backLabel="結束" width={480}>
      <div className="streak-stats" aria-live="polite">
        <div>
          <span>連勝</span>
          <b>{streak}</b>
        </div>
        <div>
          <span>分數</span>
          <b>{score}</b>
        </div>
        <div>
          <span>最佳</span>
          <b>{Math.max(best, streak)}</b>
        </div>
      </div>

      <div className="streak-timeline" role="img" aria-label={`第 ${stage + 1} 段，共 ${STREAK_STAGES_SEC.length} 段`}>
        {STREAK_STAGES_SEC.map((sec, i) => {
          const prev = i === 0 ? 0 : STREAK_STAGES_SEC[i - 1];
          const state = i < stage ? 'is-done' : i === stage ? 'is-now' : '';
          return (
            <div key={sec} className={`streak-seg ${state}`} style={{ flexGrow: sec - prev }}>
              <span className="streak-seg-bar">
                {i === stage && !revealed && spinning && !reduce ? (
                  <i key={playTick} className="is-run" style={{ animationDuration: `${sec}s` }} />
                ) : (
                  <i />
                )}
              </span>
              <span className="streak-seg-label">{sec}s</span>
            </div>
          );
        })}
      </div>

      <div className="stage">
        <StageDisc bare status={spinning ? 'playing' : status === 'loading' ? 'loading' : status === 'error' ? 'error' : 'idle'}>
          {revealed ? (
            <AnswerSticker
              key={answer.songId}
              title={answer.title}
              artist={answer.artist}
              coverUrl={covers[answer.songId] ?? null}
            />
          ) : (
            <button
              type="button"
              onClick={handleStageButton}
              className="stage-sticker is-button"
              aria-label={spinning ? '暫停' : hasStarted && status !== 'finished' && status !== 'error' ? '繼續播放' : '播放這一段'}
              disabled={!controller || !question}
            >
              {spinning ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
        </StageDisc>

        <p className="stage-status" data-state={status} aria-live="polite">
          {revealed ? '答案公布' : STATUS_LABEL[status]}
        </p>
      </div>

      {revealed ? (
        <div className="streak-reveal">
          <p className={`streak-verdict ${outcome === 'correct' ? 'is-ok' : 'is-bad'}`}>
            {outcome === 'correct' ? `答對了　+${lastGain} 分` : '沒猜中，連勝結束'}
          </p>
          {answer.reveal && (
            <button type="button" onClick={handleReplayReveal} className="btn btn-ghost btn-sm">
              {spinning ? '暫停' : status === 'paused' ? '繼續播放' : '聽這首歌'}
            </button>
          )}
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}
          {outcome === 'correct' ? (
            <>
              <button type="button" onClick={handleNext} disabled={busy} className="btn btn-primary btn-block" autoFocus>
                下一首
              </button>
              <button type="button" onClick={handleEndRun} disabled={busy} className="btn-text">
                結束挑戰並結算
              </button>
            </>
          ) : (
            <button type="button" onClick={() => submitScore()} className="btn btn-primary btn-block" autoFocus>
              查看成績
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="streak-chips" aria-live="polite">
            {wrong.length === 0 ? (
              <span className="streak-chips-empty">猜錯的答案會顯示在這裡</span>
            ) : (
              wrong.map((w, i) => (
                <motion.span
                  key={`${i}-${w}`}
                  className="streak-chip"
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {w}
                </motion.span>
              ))
            )}
          </div>

          <form onSubmit={handleGuess} className="streak-form">
            <motion.div
              key={shakeKey}
              className="streak-input-shake"
              animate={shakeKey > 0 && !reduce ? { x: [0, -8, 8, -5, 5, 0] } : undefined}
              transition={{ duration: 0.35 }}
            >
              <SongSearchInput
                value={input}
                pickedId={pickedId}
                onChange={(v, id) => {
                  setInput(v);
                  setPickedId(id);
                }}
                songs={songIndex}
                inputRef={inputRef}
                placeholder="輸入歌名或歌手關鍵字…"
                listId="streak-suggest"
              />
            </motion.div>
            <button type="submit" className="btn btn-primary" disabled={!input.trim() || busy}>
              猜
            </button>
          </form>
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem', textAlign: 'center' }}>{error}</p>}

          <div className="streak-actions">
            {stage < LAST_STAGE ? (
              <button type="button" onClick={handleMore} disabled={busy} className="btn btn-ghost">
                多聽 {STREAK_STAGES_SEC[stage + 1] - STREAK_STAGES_SEC[stage]} 秒（放棄這段）
              </button>
            ) : (
              <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>已是最後一段</span>
            )}
            <button type="button" onClick={handleGiveUp} disabled={busy} className="btn-text">
              直接公布答案
            </button>
          </div>
        </>
      )}
    </PageShell>
  );
}
