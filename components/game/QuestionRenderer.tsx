'use client';

import { useEffect, useRef, useState } from 'react';
import type { QuestionPayload } from '../../lib/types/question';
import type { Song } from '../../lib/types/song';
import { AudioController, AudioLoadState } from '../../lib/audio/audioController';

interface QuestionRendererProps {
  question: QuestionPayload;
  song: Song;
}

export function QuestionRenderer({ question, song }: QuestionRendererProps) {
  const controllerRef = useRef<AudioController | null>(null);
  const [loadState, setLoadState] = useState<AudioLoadState>('idle');

  useEffect(() => {
    controllerRef.current = new AudioController();
    return () => {
      controllerRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (question.renderType === 'text-lyric') return;
    const controller = controllerRef.current;
    if (!controller) return;

    const startSec = question.renderType === 'audio-intro' ? 0 : question.clipStartSec ?? 0;
    const durationSec =
      question.renderType === 'audio-intro' ? question.introEndSec : question.clipDurationSec;

    controller.playSegment(song.audioUrl, startSec, durationSec).then(() => {
      setLoadState(controller.getLoadState());
    });

    return () => {
      controller.stop();
    };
  }, [question, song.audioUrl]);

  function handleReplay() {
    if (question.renderType === 'text-lyric') return;
    const controller = controllerRef.current;
    if (!controller) return;
    const startSec = question.renderType === 'audio-intro' ? 0 : question.clipStartSec ?? 0;
    const durationSec =
      question.renderType === 'audio-intro' ? question.introEndSec : question.clipDurationSec;
    controller.playSegment(song.audioUrl, startSec, durationSec);
  }

  if (question.renderType === 'text-lyric') {
    return (
      <div
        style={{
          padding: '32px',
          borderRadius: '16px',
          background: 'var(--bg-raised)',
          border: '1px solid var(--groove)',
          fontFamily: 'var(--font-display)',
          fontSize: '1.5rem',
          textAlign: 'center',
          maxWidth: '560px',
        }}
      >
        {question.lyricLineText || '（此題無可用歌詞）'}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      <div
        style={{
          width: '96px',
          height: '96px',
          borderRadius: '50%',
          background:
            'repeating-radial-gradient(circle, var(--groove) 0px, var(--groove) 3px, var(--bg-raised) 3px, var(--bg-raised) 7px)',
          border: '2px solid var(--accent)',
        }}
      />
      {loadState === 'error' && (
        <p style={{ color: 'var(--error)', fontSize: '0.875rem' }}>
          音訊載入失敗，請重新播放
        </p>
      )}
      <button
        onClick={handleReplay}
        style={{
          padding: '8px 16px',
          borderRadius: '8px',
          border: '1px solid var(--groove)',
          background: 'transparent',
          color: 'var(--ink)',
        }}
      >
        重新播放
      </button>
    </div>
  );
}
