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
          width: '68px',
          height: '68px',
          borderRadius: '50%',
          position: 'relative',
          background:
            'repeating-radial-gradient(circle, var(--groove) 0px, var(--groove) 2px, var(--bg-raised) 2px, var(--bg-raised) 5px)',
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
            }}
          >
            {/* 自畫的線條圖示取代 ⚠️／✓ emoji——理由跟名次徽章一樣，emoji 在不同裝置上
                粗細、顏色不一致，跟整站線條圖示語言放在一起會顯得突兀。 */}
            {status === 'error' ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 9v4.5M12 17h.01M10.6 3.9 2.4 18a1.5 1.5 0 0 0 1.3 2.25h16.6a1.5 1.5 0 0 0 1.3-2.25L13.4 3.9a1.5 1.5 0 0 0-2.8 0Z"
                  stroke="var(--error)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5 10 17.5 19 7" stroke="var(--ink-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        )}
      </div>
      <span style={{ fontSize: '0.8rem', color: STATUS_TEXT_COLOR[status], fontWeight: 500 }}>
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
}
