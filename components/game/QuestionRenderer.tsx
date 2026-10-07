'use client';

import { useEffect, useState } from 'react';
import type { QuestionPayload } from '../../lib/types/question';
import type { Song } from '../../lib/types/song';
import type { AudioController, AudioPlaybackStatus } from '../../lib/audio/audioController';
import { AnswerSticker } from './AnswerSticker';
import { resolvePlaybackTarget, resolvePlaybackFallback } from '../../lib/audio/resolvePlaybackTarget';

interface QuestionRendererProps {
  question: QuestionPayload;
  song: Song;
  /** 由 GamePage 建立並持有，整場比賽期間為同一個實例，換題不重建 */
  controller: AudioController | null;
  /** 公布答案後傳入：中心貼紙翻成歌名／歌手 */
  reveal?: { title: string; artist?: string; coverUrl?: string | null } | null;
}

const STATUS_LABEL: Record<AudioPlaybackStatus, string> = {
  idle: '點中間開始播放',
  loading: '載入中…',
  playing: '播放中',
  paused: '已暫停',
  finished: '播放完畢，可再聽一次',
  error: '播放失敗，點中間重試',
};

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

/**
 * 單機模式的「舞台」：一張大唱片，中心貼紙就是播放鍵。
 * 播放時唱片旋轉、載入時脈動；公布答案後貼紙翻面，顯示歌名與歌手——
 * 「答案寫在唱片標籤上」是這個畫面的記憶點。
 * 純 UI 元件：呼叫端須用 key={currentRoundIndex} 掛載，讓播放狀態在換題時重置。
 */
export function QuestionRenderer({ question, song, controller, reveal }: QuestionRendererProps) {
  const [status, setStatus] = useState<AudioPlaybackStatus>('idle');

  useEffect(() => {
    if (!controller) return;
    controller.setOnStatusChange(setStatus);
    return () => controller.setOnStatusChange(undefined);
  }, [controller]);

  const playbackTarget = resolvePlaybackTarget(song, question);
  const fallbackTarget = resolvePlaybackFallback(song, question);

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
    await controller.play(playbackTarget.source, playbackTarget.idOrUrl, playbackTarget.startSec, playbackTarget.durationSec, fallbackTarget);
  }

  function handleRestart() {
    if (!controller || !playbackTarget) return;
    controller.play(playbackTarget.source, playbackTarget.idOrUrl, playbackTarget.startSec, playbackTarget.durationSec, fallbackTarget);
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
  const spinning = status === 'playing';
  const loading = status === 'loading';
  const isError = status === 'error';

  return (
    <div className="stage">
      <div className="stage-disc-wrap">
        <div
          className={`stage-disc${spinning ? ' is-spinning' : ''}${loading ? ' is-loading' : ''}${isError ? ' is-error' : ''}`}
          aria-hidden="true"
        />
        {spinning && <span className="stage-ring" aria-hidden="true" />}
        <div className="stage-sticker-slot">
          {reveal ? (
            <AnswerSticker title={reveal.title} artist={reveal.artist} coverUrl={reveal.coverUrl} />
          ) : (
            <button
              type="button"
              onClick={handlePlayPause}
              className="stage-sticker is-button"
              aria-label={spinning ? '暫停' : hasStarted && status !== 'finished' && !isError ? '繼續播放' : '播放'}
              disabled={!controller || !playbackTarget}
            >
              {spinning ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
        </div>
      </div>

      <p className="stage-status" data-state={status} aria-live="polite">
        {reveal ? '答案公布' : STATUS_LABEL[status]}
      </p>

      <div className="stage-controls">
        {reveal && (
          <button type="button" onClick={handlePlayPause} className="btn btn-ghost btn-sm">
            {spinning ? '暫停' : hasStarted && status === 'paused' ? '繼續播放' : '再聽一次'}
          </button>
        )}
        {hasStarted && (
          <button type="button" onClick={handleRestart} className="btn btn-ghost btn-sm">
            從頭播放
          </button>
        )}
      </div>
    </div>
  );
}
