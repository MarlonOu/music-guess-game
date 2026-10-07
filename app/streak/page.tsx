'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { PageShell } from '../../components/layout/PageShell';
import { StageDisc } from '../../components/game/StageDisc';
import { AnswerSticker } from '../../components/game/AnswerSticker';
import { songRepository } from '../../lib/repository/songRepository';
import { getGlobalAudioController } from '../../lib/audio/globalAudioController';
import type { AudioController, AudioPlaybackStatus } from '../../lib/audio/audioController';
import { resolvePlaybackTarget, resolvePlaybackFallback } from '../../lib/audio/resolvePlaybackTarget';
import { isAnswerCorrect } from '../../lib/engine/answerUtils';
import { STREAK_STAGES_SEC, STREAK_BEST_STORAGE_KEY, streakPointsForStage } from '../../lib/constants/streak';
import type { Song } from '../../lib/types/song';
import type { Artist } from '../../lib/types/theme';

type Phase = 'loading' | 'intro' | 'playing' | 'revealed' | 'over';

const LAST_STAGE = STREAK_STAGES_SEC.length - 1;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function isPlayable(song: Song): boolean {
  return resolvePlaybackTarget(song, { renderType: 'audio-intro' }) !== null;
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

export default function StreakPage() {
  const reduce = useReducedMotion();
  const [controller, setController] = useState<AudioController | null>(null);
  const [status, setStatus] = useState<AudioPlaybackStatus>('idle');
  const [playTick, setPlayTick] = useState(0);

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);

  const [queue, setQueue] = useState<Song[]>([]);
  const [qi, setQi] = useState(0);
  const [stage, setStage] = useState(0);
  const [wrong, setWrong] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<'correct' | 'failed' | null>(null);
  const [lastGain, setLastGain] = useState(0);
  const [streak, setStreak] = useState(0);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [starting, setStarting] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [covers, setCovers] = useState<Record<string, string | null>>({});

  const [input, setInput] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const artistName = useMemo(() => {
    const map = new Map(artists.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? '';
  }, [artists]);

  // 外部播放器（全域共用實例）與題庫載入
  useEffect(() => {
    const c = getGlobalAudioController();
    c.setOnStatusChange(setStatus);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 連接外部共用播放器的合法例外
    setController(c);
    c.preload();
    try {
      const saved = Number(localStorage.getItem(STREAK_BEST_STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) setBest(saved);
    } catch {
      // 隱私模式下讀不到就當作 0
    }
    let cancelled = false;
    Promise.all([songRepository.getAll(), songRepository.getAllArtists()]).then(
      ([s, a]) => {
        if (cancelled) return;
        setSongs(s);
        setArtists(a);
        setPhase('intro');
      },
      () => {
        if (!cancelled) setLoadError('題庫載入失敗，請重新整理頁面');
      }
    );
    return () => {
      cancelled = true;
      c.setOnStatusChange(undefined);
      c.stop();
    };
  }, []);

  const current = phase === 'playing' || phase === 'revealed' ? queue[qi] : undefined;

  const playStage = useCallback(
    (song: Song, stageIndex: number) => {
      if (!controller) return;
      const question = { renderType: 'audio-intro' as const };
      const target = resolvePlaybackTarget(song, question);
      if (!target) return;
      setPlayTick((t) => t + 1);
      // 主要來源（YouTube）失敗時自動改用 Apple／Deezer 試聽
      const fb = resolvePlaybackFallback(song, question);
      controller.play(
        target.source,
        target.idOrUrl,
        0,
        STREAK_STAGES_SEC[stageIndex],
        fb ? { ...fb, durationSec: STREAK_STAGES_SEC[stageIndex] } : null
      );
    },
    [controller]
  );

  // 公布答案時抓封面（沿用單機模式的封面查詢）
  const revealedId = phase === 'revealed' ? current?.id : undefined;
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

  const suggestions = useMemo(() => {
    const q = normalize(input);
    if (!q || pickedId) return [];
    return songs
      .filter((s) => normalize(s.title).includes(q) || normalize(artistName(s.artistId)).includes(q))
      .slice(0, 6);
  }, [input, pickedId, songs, artistName]);

  function resetQuestionState() {
    setStage(0);
    setWrong([]);
    setInput('');
    setPickedId(null);
    setHi(0);
    setOutcome(null);
  }

  async function handleStart() {
    if (!controller || starting) return;
    const pool = songs.filter(isPlayable);
    if (pool.length === 0) {
      setLoadError('目前題庫沒有可播放的歌曲');
      return;
    }
    setLoadError(null);
    setStarting(true);
    // 開始鍵是真正的使用者手勢，先解鎖播放器再開始第一段
    await controller.unlock();
    setStarting(false);
    const q = shuffle(pool);
    setQueue(q);
    setQi(0);
    setStreak(0);
    setScore(0);
    setNewBest(false);
    resetQuestionState();
    setPhase('playing');
    playStage(q[0], 0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function reveal(result: 'correct' | 'failed', gain: number) {
    setOutcome(result);
    setLastGain(gain);
    setPhase('revealed');
    // 公布後把這首歌播出來（YouTube 播到結束、Apple/Deezer 播完試聽片段）
    if (controller && current) {
      const question = { renderType: 'audio-intro' as const };
      const target = resolvePlaybackTarget(current, question);
      if (target) {
        setPlayTick((t) => t + 1);
        controller.play(target.source, target.idOrUrl, 0, undefined, resolvePlaybackFallback(current, question));
      }
    }
  }

  function advanceStage() {
    if (!current || stage >= LAST_STAGE) return;
    const next = stage + 1;
    setStage(next);
    playStage(current, next);
  }

  function handleGuess(e?: React.FormEvent) {
    e?.preventDefault();
    if (!current || phase !== 'playing') return;
    const text = input.trim();
    if (!text) return;
    const picked = pickedId ? songs.find((s) => s.id === pickedId) : undefined;
    const correct =
      pickedId === current.id ||
      isAnswerCorrect(picked?.title ?? text, current.title, current.aliases);
    if (correct) {
      const gain = streakPointsForStage(stage);
      setStreak((n) => n + 1);
      setScore((n) => n + gain);
      reveal('correct', gain);
      return;
    }
    setWrong((w) => [...w, picked ? picked.title : text]);
    setInput('');
    setPickedId(null);
    setShakeKey((k) => k + 1);
    if (stage >= LAST_STAGE) {
      reveal('failed', 0);
    } else {
      advanceStage();
    }
  }

  function handleGiveUp() {
    if (phase !== 'playing') return;
    reveal('failed', 0);
  }

  function finishRun() {
    controller?.stop();
    if (streak > best) {
      setBest(streak);
      setNewBest(true);
      try {
        localStorage.setItem(STREAK_BEST_STORAGE_KEY, String(streak));
      } catch {
        // 存不了就只在本次顯示
      }
    }
    setPhase('over');
  }

  function handleNext() {
    const nextIndex = qi + 1;
    if (nextIndex >= queue.length) {
      finishRun();
      return;
    }
    setQi(nextIndex);
    resetQuestionState();
    setPhase('playing');
    playStage(queue[nextIndex], 0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function pickSuggestion(song: Song) {
    setInput(song.title);
    setPickedId(song.id);
    setHi(0);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickSuggestion(suggestions[hi] ?? suggestions[0]);
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  }

  function handleStageButton() {
    if (!controller || !current) return;
    if (status === 'playing') {
      controller.pause();
    } else if (status === 'paused') {
      controller.resume();
    } else {
      playStage(current, stage);
    }
  }

  const spinning = status === 'playing';

  // ------------------------------------------------------------------ 畫面
  if (phase === 'loading') {
    return (
      <PageShell title="無限連勝" subtitle="準備題庫中…">
        {loadError ? <p style={{ color: 'var(--error)' }}>{loadError}</p> : <div className="loading-disc" aria-hidden="true" />}
      </PageShell>
    );
  }

  if (phase === 'intro') {
    return (
      <PageShell title="無限連勝" subtitle="只聽 1 秒，認得出幾首？一路連勝，直到猜錯為止。" width={480}>
        <ol className="streak-rules">
          <li>
            <b>1 → 16 秒</b>
            <span>每首歌從 {STREAK_STAGES_SEC[0]} 秒開始，猜錯或按「多聽」就解鎖下一段：{STREAK_STAGES_SEC.join('、')} 秒。</span>
          </li>
          <li>
            <b>越早猜中越高分</b>
            <span>第 1 段答對 {streakPointsForStage(0)} 分，每晚一段少 1 分，最後一段 1 分。</span>
          </li>
          <li>
            <b>連勝不斷線</b>
            <span>6 段都沒猜中或放棄公布答案，連勝就結束。最佳紀錄存在這台裝置上。</span>
          </li>
        </ol>

        <div className="streak-best">
          <span>目前最佳連勝</span>
          <b>{best}</b>
        </div>

        {loadError && <p style={{ color: 'var(--error)', fontSize: '0.88rem' }}>{loadError}</p>}
        <button type="button" onClick={handleStart} disabled={starting} className="btn btn-primary btn-block">
          {starting ? '準備中…' : '開始挑戰'}
        </button>
      </PageShell>
    );
  }

  if (phase === 'over') {
    return (
      <PageShell title="挑戰結束" subtitle={newBest ? '新的最佳紀錄' : undefined} backLabel="首頁">
        <div className="streak-result">
          <div className="streak-result-main">
            <span>連勝</span>
            <b>{streak}</b>
            <span>首</span>
          </div>
          <dl>
            <div>
              <dt>總分</dt>
              <dd>{score}</dd>
            </div>
            <div>
              <dt>最佳連勝</dt>
              <dd>{Math.max(best, streak)}</dd>
            </div>
          </dl>
        </div>
        <button type="button" onClick={() => setPhase('intro')} className="btn btn-primary btn-block">
          再挑戰一次
        </button>
        <Link href="/" className="btn btn-ghost btn-block" style={{ textAlign: 'center' }}>
          回到首頁
        </Link>
      </PageShell>
    );
  }

  // playing / revealed
  const revealed = phase === 'revealed' && current;
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

      <div className="stage" style={{ alignSelf: 'center' }}>
        <StageDisc bare={Boolean(revealed)} status={spinning ? 'playing' : status === 'loading' ? 'loading' : status === 'error' ? 'error' : 'idle'}>
          {revealed && current ? (
            <AnswerSticker
              key={current.id}
              title={current.title}
              artist={artistName(current.artistId)}
              coverUrl={covers[current.id] ?? null}
            />
          ) : (
            <button
              type="button"
              className="stage-sticker is-button"
              onClick={handleStageButton}
              aria-label={spinning ? '暫停' : '播放這一段'}
            >
              {spinning ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
        </StageDisc>
      </div>

      {revealed && current ? (
        <div className="streak-reveal">
          <p className={`streak-verdict ${outcome === 'correct' ? 'is-ok' : 'is-bad'}`}>
            {outcome === 'correct' ? `答對了　+${lastGain} 分` : '沒猜中，連勝結束'}
          </p>
          {outcome === 'correct' ? (
            <button type="button" onClick={handleNext} className="btn btn-primary btn-block" autoFocus>
              下一首
            </button>
          ) : (
            <button type="button" onClick={finishRun} className="btn btn-primary btn-block" autoFocus>
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
              className="streak-input-wrap"
              animate={shakeKey > 0 && !reduce ? { x: [0, -8, 8, -5, 5, 0] } : undefined}
              transition={{ duration: 0.35 }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setPickedId(null);
                  setHi(0);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 120)}
                onKeyDown={handleKeyDown}
                placeholder="輸入歌名或歌手…"
                className="field"
                role="combobox"
                aria-expanded={focused && suggestions.length > 0}
                aria-controls="streak-suggest"
                aria-autocomplete="list"
                autoComplete="off"
                enterKeyHint="go"
              />
              {focused && suggestions.length > 0 && (
                <ul id="streak-suggest" className="streak-suggest" role="listbox">
                  {suggestions.map((s, i) => (
                    <li
                      key={s.id}
                      role="option"
                      aria-selected={i === hi}
                      className={i === hi ? 'is-hi' : undefined}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickSuggestion(s);
                      }}
                    >
                      <span>{s.title}</span>
                      <small>{artistName(s.artistId)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
            <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
              猜
            </button>
          </form>

          <div className="streak-actions">
            {stage < LAST_STAGE ? (
              <button type="button" onClick={advanceStage} className="btn btn-ghost">
                多聽 {STREAK_STAGES_SEC[stage + 1] - STREAK_STAGES_SEC[stage]} 秒（放棄這段）
              </button>
            ) : (
              <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>已是最後一段</span>
            )}
            <button type="button" onClick={handleGiveUp} className="btn-text">
              直接公布答案
            </button>
          </div>
        </>
      )}
    </PageShell>
  );
}
