'use client';

import type { AudioPlaybackStatus } from '../../lib/audio/audioController';

const STATUS_LABEL: Record<AudioPlaybackStatus, string> = {
  idle: '尚未播放',
  loading: '載入中…',
  playing: '播放中',
  paused: '已暫停',
  finished: '播放完畢',
  error: '播放失敗',
};

const STATUS_BORDER_COLOR: Record<AudioPlaybackStatus, string> = {
  idle: 'var(--groove)',
  loading: 'var(--accent)',
  playing: 'var(--success)',
  paused: 'var(--accent)',
  finished: 'var(--groove)',
  error: 'var(--error)',
};

const STATUS_TEXT_COLOR: Record<AudioPlaybackStatus, string> = {
  idle: 'var(--ink-dim)',
  loading: 'var(--accent)',
  playing: 'var(--success)',
  paused: 'var(--accent)',
  finished: 'var(--ink-dim)',
  error: 'var(--error)',
};

/**
 * 以「轉動的黑膠唱片」為視覺主軸呈現音訊播放狀態，讓玩家能一眼分辨：
 * - loading：脈動閃爍（尚在等待 YouTube 播放器回報開始播放）
 * - playing：持續旋轉
 * - paused／finished：靜止但邊框顏色不同，區分「使用者自己按暫停」與「片段時間到自動停止」
 * - error：顯示警示圖示
 * 單機（QuestionRenderer）與線上模式（線上房間 PlayingView）共用同一元件，確保視覺語言一致。
 */
export function AudioStatusIndicator({ status }: { status: AudioPlaybackStatus }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
      <div
        style={{
          width: '96px',
          height: '96px',
          borderRadius: '50%',
          position: 'relative',
          background:
            'repeating-radial-gradient(circle, var(--groove) 0px, var(--groove) 3px, var(--bg-raised) 3px, var(--bg-raised) 7px)',
          border: `2px solid ${STATUS_BORDER_COLOR[status]}`,
          opacity: status === 'idle' || status === 'finished' ? 0.55 : 1,
          animation:
            status === 'playing'
              ? 'vinyl-spin 2.4s linear infinite'
              : status === 'loading'
                ? 'vinyl-pulse 1s ease-in-out infinite'
                : 'none',
          transition: 'opacity 0.2s ease, border-color 0.2s ease',
        }}
      >
        {(status === 'error' || status === 'finished') && (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
            }}
          >
            {status === 'error' ? '⚠️' : '✓'}
          </span>
        )}
      </div>
      <span style={{ fontSize: '0.8rem', color: STATUS_TEXT_COLOR[status], fontWeight: 500 }}>
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
}
