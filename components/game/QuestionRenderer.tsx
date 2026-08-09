'use client';

import { useState } from 'react';
import type { QuestionPayload } from '../../lib/types/question';
import type { Song } from '../../lib/types/song';
import type { AudioController, AudioLoadState } from '../../lib/audio/audioController';

interface QuestionRendererProps {
  question: QuestionPayload;
  song: Song;
  /** 由 GamePage 建立並持有，整場比賽期間為同一個實例，換題不重建 */
  controller: AudioController | null;
}

// 純 UI 狀態元件：本身不建立／持有播放器，只透過傳入的 controller 呼叫播放控制。
// 呼叫端須在每次換題時以 key={currentRoundIndex} 掛載本元件，讓按鈕顯示的播放狀態正確重置。
export function QuestionRenderer({ question, song, controller }: QuestionRendererProps) {
  const [loadState, setLoadState] = useState<AudioLoadState>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  // 該題是否已按過播放（決定按鈕顯示「播放」或「繼續播放」）
  const [hasStarted, setHasStarted] = useState(false);

  const startSec = question.renderType === 'audio-intro' ? 0 : question.clipStartSec ?? 0;
  const durationSec =
    question.renderType === 'audio-intro' ? question.introEndSec : question.clipDurationSec;

  async function handlePlayPause() {
    if (!controller || question.renderType === 'text-lyric') return;

    if (isPlaying) {
      controller.pause();
      setIsPlaying(false);
      return;
    }

    if (hasStarted && controller.getLoadState() === 'ready') {
      controller.resume();
      setIsPlaying(controller.getIsPlaying());
      return;
    }

    setHasStarted(true);
    await controller.play(song.youtubeVideoId, startSec, durationSec);
    setLoadState(controller.getLoadState());
    setIsPlaying(controller.getIsPlaying());
  }

  function handleRestart() {
    if (!controller || question.renderType === 'text-lyric') return;
    setHasStarted(true);
    controller.play(song.youtubeVideoId, startSec, durationSec).then(() => {
      setLoadState(controller.getLoadState());
      setIsPlaying(controller.getIsPlaying());
    });
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

  const playPauseLabel = isPlaying ? '暫停' : hasStarted ? '繼續播放' : '播放';

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
          border: `2px solid ${isPlaying ? 'var(--success)' : 'var(--accent)'}`,
        }}
      />
      {loadState === 'error' && (
        <p style={{ color: 'var(--error)', fontSize: '0.875rem' }}>
          音訊載入失敗，請重新播放
        </p>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handlePlayPause}
          style={{
            padding: '10px 24px',
            borderRadius: '8px',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            fontWeight: 600,
            minWidth: '96px',
          }}
        >
          {playPauseLabel}
        </button>
        {hasStarted && (
          <button
            onClick={handleRestart}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid var(--groove)',
              background: 'transparent',
              color: 'var(--ink)',
            }}
          >
            從頭播放
          </button>
        )}
      </div>
    </div>
  );
}
