'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { AudioController } from '../../lib/audio/audioController';
import { speedrunRepository } from '../../lib/repository/speedrunRepository';
import { estimateServerNow } from '../../lib/client/serverClock';
import type { SpeedrunQuestion, SpeedrunSubmitResponse, SpeedrunLeaderboardEntry } from '../../lib/types/speedrun';

const QUESTION_COUNT = 10;
/** 答錯後鎖定不能再選的秒數，逞罰機制的核心 */
const WRONG_ANSWER_LOCKOUT_MS = 2000;
/** 碼表畫面更新頻率；不需要真的到毫秒等級的更新頻率，肉眼看起來夠平滑即可，
 *  太頻繁只會白白增加不必要的重新渲染 */
const STOPWATCH_TICK_MS = 33;

type Phase = 'intro' | 'loading' | 'playing' | 'submitting' | 'results';

/** 毫秒數轉成「分:秒.毫秒」格式，例如 83421 → "01:23.421" */
function formatStopwatch(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export default function SpeedrunPage() {
  const playerContainerId = useId().replace(/:/g, '-');
  const audioControllerRef = useRef<AudioController | null>(null);
  const raceStartRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('intro');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [questions, setQuestions] = useState<SpeedrunQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [locked, setLocked] = useState(false);
  const [wrongSongId, setWrongSongId] = useState<string | null>(null);

  const [results, setResults] = useState<SpeedrunSubmitResponse | null>(null);
  const [introLeaderboard, setIntroLeaderboard] = useState<SpeedrunLeaderboardEntry[] | null>(null);

  // 建立這個頁面自己的播放器實例（比照單機模式，不用線上模式那種跨頁面共用的全域實例——
  // 速通模式是單一頁面從頭玩到尾的線性流程，離開頁面播放器就該一併釋放）。
  useEffect(() => {
    const controller = new AudioController(playerContainerId);
    audioControllerRef.current = controller;
    controller.preload();
    return () => {
      controller.dispose();
      audioControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 碼表更新：從 raceStartRef 記錄的時間點起算，用校正過的伺服器時間（見 lib/client/serverClock.ts）
  // 而不是裝置自己的 Date.now()，避免裝置時鐘不準造成顯示跟伺服器實際判定的成績有落差。
  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = setInterval(() => {
      if (raceStartRef.current !== null) {
        setElapsedMs(estimateServerNow() - raceStartRef.current);
      }
    }, STOPWATCH_TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  // 換題（或剛進入 playing 狀態）就播放目前這題的音訊
  useEffect(() => {
    if (phase !== 'playing') return;
    const controller = audioControllerRef.current;
    const q = questions[questionIndex];
    if (!controller || !q || !q.source || !q.playbackId) return;
    controller.play(q.source, q.playbackId, q.startSec, q.durationSec);
  }, [phase, questionIndex, questions]);

  async function handleStart() {
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      setError('請輸入暱稱');
      return;
    }
    // 真正的使用者手勢（按鈕點擊），在任何 await 之前先觸發播放解鎖，不等待其完成——
    // 理由跟線上模式加入房間時的做法一樣，見 AudioController.unlock() 的說明。
    audioControllerRef.current?.unlock();

    setError(null);
    setPhase('loading');
    const result = await speedrunRepository.start();
    if (!result.ok || !result.data) {
      setError(result.error ?? '開始挑戰失敗');
      setPhase('intro');
      return;
    }

    setToken(result.data.token);
    setQuestions(result.data.questions);
    setQuestionIndex(0);
    setResults(null);
    setSubmitError(null);
    raceStartRef.current = estimateServerNow();
    setElapsedMs(0);
    setPhase('playing');
  }

  async function handleChoiceClick(songId: string) {
    if (locked || !token) return;
    const result = await speedrunRepository.check(token, questionIndex, songId);
    if (!result.ok || !result.data) {
      setError(result.error ?? '判定失敗，請重新開始挑戰');
      setPhase('intro');
      return;
    }

    if (!result.data.correct) {
      // 逞罰機制：答錯鎖定 2 秒不能再選，碼表繼續跑（不會暫停），答錯確實要付出時間代價
      setWrongSongId(songId);
      setLocked(true);
      setTimeout(() => {
        setLocked(false);
        setWrongSongId(null);
      }, WRONG_ANSWER_LOCKOUT_MS);
      return;
    }

    audioControllerRef.current?.stop();

    if (result.data.finished) {
      await submitScore();
    } else {
      setQuestionIndex((i) => i + 1);
    }
  }

  async function submitScore() {
    if (!token) return;
    setPhase('submitting');
    setSubmitError(null);
    const result = await speedrunRepository.submit(token, displayName.trim());
    if (!result.ok || !result.data) {
      setSubmitError(result.error ?? '送出成績失敗');
      return;
    }
    setResults(result.data);
    setPhase('results');
  }

  async function loadIntroLeaderboard() {
    if (introLeaderboard !== null) {
      setIntroLeaderboard(null); // 已經展開了，再按一次收合
      return;
    }
    const result = await speedrunRepository.getLeaderboard();
    if (result.ok && result.data) setIntroLeaderboard(result.data);
  }

  function handleRetry() {
    setPhase('intro');
    setResults(null);
    setError(null);
  }

  const inputStyle = {
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid var(--groove)',
    background: 'var(--bg-raised)',
    color: 'var(--ink)',
    fontSize: '1rem',
  };
  const buttonStyle = {
    padding: '14px 24px',
    borderRadius: '12px',
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    fontWeight: 600,
    fontSize: '1rem',
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px',
        gap: '24px',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>SPEEDRUN</span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem' }}>速通挑戰</h1>
      </header>

      {phase === 'intro' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '360px' }}>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', textAlign: 'center' }}>
            隨機片段猜歌＋選擇題搶答，共 {QUESTION_COUNT} 題，碼表計時，答錯鎖 {WRONG_ANSWER_LOCKOUT_MS / 1000} 秒，
            全部答對後看你的名次。
          </p>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="輸入暱稱"
            maxLength={20}
            style={inputStyle}
          />
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem', textAlign: 'center' }}>{error}</p>}
          <button onClick={handleStart} style={buttonStyle}>
            開始挑戰
          </button>
          <button
            onClick={loadIntroLeaderboard}
            style={{ ...inputStyle, background: 'transparent', cursor: 'pointer' }}
          >
            {introLeaderboard !== null ? '收合排行榜 ▲' : '查看目前排行榜 ▼'}
          </button>
          {introLeaderboard !== null && <LeaderboardList entries={introLeaderboard} />}
          <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', textAlign: 'center' }}>
            返回首頁
          </Link>
        </div>
      )}

      {phase === 'loading' && <p style={{ color: 'var(--ink-dim)' }}>題目準備中…</p>}

      {phase === 'playing' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', width: '100%', maxWidth: '420px' }}>
          <p style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
            第 {questionIndex + 1} / {questions.length} 題
          </p>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '2.4rem',
              fontWeight: 700,
              color: locked ? 'var(--error)' : 'var(--accent)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatStopwatch(elapsedMs)}
          </p>
          {locked && (
            <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>
              答錯了，等 {WRONG_ANSWER_LOCKOUT_MS / 1000} 秒才能再選…
            </p>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '10px',
              width: '100%',
            }}
          >
            {questions[questionIndex]?.choices.map((choice) => {
              const isWrongPick = wrongSongId === choice.songId;
              return (
                <button
                  key={choice.songId}
                  onClick={() => handleChoiceClick(choice.songId)}
                  disabled={locked}
                  style={{
                    padding: '16px 12px',
                    borderRadius: '12px',
                    border: isWrongPick ? '1px solid var(--error)' : '1px solid var(--groove)',
                    background: isWrongPick ? 'rgba(220,53,69,0.12)' : 'var(--bg-raised)',
                    color: 'var(--ink)',
                    fontSize: '0.95rem',
                    lineHeight: 1.3,
                    opacity: locked && !isWrongPick ? 0.5 : 1,
                  }}
                >
                  {choice.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'submitting' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          {submitError ? (
            <>
              <p style={{ color: 'var(--error)', fontSize: '0.9rem', textAlign: 'center' }}>{submitError}</p>
              <button onClick={submitScore} style={buttonStyle}>
                重試送出成績
              </button>
            </>
          ) : (
            <p style={{ color: 'var(--ink-dim)' }}>送出成績中…</p>
          )}
        </div>
      )}

      {phase === 'results' && results && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', width: '100%', maxWidth: '420px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
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
              {formatStopwatch(results.totalTimeMs)}
            </p>
            <p style={{ fontSize: '1.1rem' }}>
              全站第 <strong>{results.rank}</strong> 名（共 {results.totalRuns} 次挑戰）
            </p>
          </div>

          <div style={{ width: '100%' }}>
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: '8px' }}>排行榜 Top 100</p>
            <LeaderboardList entries={results.leaderboard} highlightId={results.scoreId} />
          </div>

          <button onClick={handleRetry} style={buttonStyle}>
            再試一次
          </button>
          <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
            返回首頁
          </Link>
        </div>
      )}
    </main>
  );
}

function LeaderboardList({ entries, highlightId }: { entries: SpeedrunLeaderboardEntry[]; highlightId?: string }) {
  if (entries.length === 0) {
    return <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', textAlign: 'center' }}>目前還沒有人上榜，當第一個吧！</p>;
  }
  return (
    <ol
      style={{
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        maxHeight: '360px',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        width: '100%',
      }}
    >
      {entries.map((entry, i) => (
        <li
          key={entry.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderRadius: '8px',
            background: entry.id === highlightId ? 'var(--bg-raised)' : 'transparent',
            border: entry.id === highlightId ? '1px solid var(--accent)' : '1px solid transparent',
            fontSize: '0.9rem',
          }}
        >
          <span>
            {i + 1}. {entry.displayName}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>{formatStopwatch(entry.totalTimeMs)}</span>
        </li>
      ))}
    </ol>
  );
}
