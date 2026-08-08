'use client';

import { useEffect, useState } from 'react';
import type { GameMode } from '../../lib/types/match';
import type { Song } from '../../lib/types/song';
import { songRepository } from '../../lib/repository/songRepository';
import { DEFAULT_ROUND_COUNT, DEFAULT_ROUND_TIME_SEC } from '../../lib/engine/gameEngine';
import { useGameEngine } from './useGameEngine';
import { QuestionRenderer } from './QuestionRenderer';
import { AnswerInput } from './AnswerInput';
import { Timer } from './Timer';

interface GamePageProps {
  mode: GameMode;
  title: string;
}

export function GamePage({ mode, title }: GamePageProps) {
  const { engine, state } = useGameEngine();
  const [songPool, setSongPool] = useState<Song[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    songRepository
      .getAll()
      .then((songs) => {
        if (cancelled) return;
        if (songs.length === 0) {
          setLoadError('目前題庫為空，無法開始遊戲');
          return;
        }
        setSongPool(songs);
        engine.start({ mode, songPool: songs, roundCount: DEFAULT_ROUND_COUNT });
      })
      .catch(() => {
        if (!cancelled) setLoadError('題庫讀取失敗');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const currentSong =
    state.currentQuestion && songPool
      ? songPool.find((s) => s.id === state.currentQuestion!.songId) ?? null
      : null;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px',
        gap: '32px',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          MUSIC GUESS
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>{title}</h1>
      </header>

      {loadError && <p style={{ color: 'var(--error)' }}>{loadError}</p>}

      {!loadError && state.status === 'idle' && <p style={{ color: 'var(--ink-dim)' }}>準備中</p>}

      {state.status === 'question' && currentSong && state.currentQuestion && (
        <>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
            <span>
              第 {state.currentRoundIndex + 1} / {state.roundCount} 題
            </span>
            <span>得分 {state.score}</span>
          </div>
          <Timer remainingSec={state.timeRemainingSec} totalSec={DEFAULT_ROUND_TIME_SEC} />
          <QuestionRenderer question={state.currentQuestion} song={currentSong} />
          <AnswerInput disabled={false} onSubmit={(answer) => engine.submitAnswer(answer)} />
        </>
      )}

      {state.status === 'reveal' && (
        <RevealPanel
          correct={state.results[state.results.length - 1]?.correct ?? false}
          correctTitle={state.results[state.results.length - 1]?.question.correctTitle ?? ''}
          onNext={() => engine.nextQuestion()}
        />
      )}

      {state.status === 'finished' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '2rem' }}>
            {state.score} / {state.roundCount}
          </p>
          <p style={{ color: 'var(--ink-dim)' }}>比賽結束</p>
        </div>
      )}
    </main>
  );
}

function RevealPanel({
  correct,
  correctTitle,
  onNext,
}: {
  correct: boolean;
  correctTitle: string;
  onNext: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
      <p style={{ color: correct ? 'var(--success)' : 'var(--error)', fontWeight: 600, fontSize: '1.25rem' }}>
        {correct ? '答對' : '答錯'}
      </p>
      <p style={{ color: 'var(--ink-dim)' }}>正確答案：{correctTitle}</p>
      <button
        onClick={onNext}
        style={{
          padding: '10px 24px',
          borderRadius: '10px',
          border: 'none',
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          fontWeight: 600,
        }}
      >
        下一題
      </button>
    </div>
  );
}
