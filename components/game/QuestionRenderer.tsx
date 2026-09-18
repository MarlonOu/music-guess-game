'use client';

import { useEffect, useState } from 'react';
import type { QuestionPayload } from '../../lib/types/question';
import type { Song } from '../../lib/types/song';
import type { AudioController, AudioPlaybackStatus } from '../../lib/audio/audioController';
import { resolvePlaybackTarget } from '../../lib/audio/resolvePlaybackTarget';
import { AudioStatusIndicator } from './AudioStatusIndicator';

interface QuestionRendererProps {
  question: QuestionPayload;
  song: Song;
  /** 由 GamePage 建立並持有，整場比賽期間為同一個實例，換題不重建 */
  controller: AudioController | null;
}

// 純 UI 狀態元件：本身不建立／持有播放器，只透過傳入的 controller 呼叫播放控制。
// 呼叫端須在每次換題時以 key={currentRoundIndex} 掛載本元件，讓按鈕顯示的播放狀態正確重置。
export function QuestionRenderer({ question, song, controller }: QuestionRendererProps) {
  const [status, setStatus] = useState<AudioPlaybackStatus>('idle');

  // 訂閱 controller 的播放狀態回呼，取代先前「呼叫完 play/pause 後手動讀一次狀態」的作法——
  // 這樣才能即時反映「loading」這種非同步中間狀態，UI 動畫才會準確。
  // 每次換題本元件都會因 key 變更而重新掛載，初始值 'idle' 已經跟「換題時 GamePage 會呼叫
  // controller.stop()」的狀態一致，這裡只需要訂閱之後的變化，不需要再額外同步讀取一次目前狀態。
  useEffect(() => {
    if (!controller) return;
    controller.setOnStatusChange(setStatus);
    return () => controller.setOnStatusChange(undefined);
  }, [controller]);

  const playbackTarget = resolvePlaybackTarget(song, question);

  async function handlePlayPause() {
    if (!controller || !playbackTarget) return;
    if (status === 'playing') {
      controller.pause();
      return;
    }
    if (status === 'paused') {
      controller.resume();
      return;
    }
    // idle／finished／error 都視為「重新播放」
    await controller.play(playbackTarget.source, playbackTarget.idOrUrl, playbackTarget.startSec, playbackTarget.durationSec);
  }

  function handleRestart() {
    if (!controller || !playbackTarget) return;
    controller.play(playbackTarget.source, playbackTarget.idOrUrl, playbackTarget.startSec, playbackTarget.durationSec);
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

  const hasStarted = status !== 'idle';
  const playPauseLabel = status === 'playing' ? '暫停' : hasStarted ? '繼續播放' : '播放';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      <AudioStatusIndicator status={status} />
      {status === 'error' && (
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
