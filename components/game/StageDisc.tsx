'use client';

import type { AudioPlaybackStatus } from '../../lib/audio/audioController';

interface StageDiscProps {
  status?: AudioPlaybackStatus;
  /** 貼紙內容：倒數數字、問號或答案 */
  children: React.ReactNode;
  /** 答案貼紙：放大並播放翻面動畫 */
  answer?: boolean;
  /** 覆寫唱片直徑 */
  size?: string;
}

/** 線上房間用的唱片舞台（無播放鍵）：狀態驅動旋轉／脈動，貼紙放任意內容。 */
export function StageDisc({ status = 'idle', children, answer, size }: StageDiscProps) {
  const spinning = status === 'playing';
  return (
    <div className="stage-disc-wrap" style={size ? ({ ['--stage' as string]: size } as React.CSSProperties) : undefined}>
      <div
        aria-hidden="true"
        className={`stage-disc${spinning ? ' is-spinning' : ''}${status === 'loading' ? ' is-loading' : ''}${status === 'error' ? ' is-error' : ''}`}
      />
      {spinning && <span className="stage-ring" aria-hidden="true" />}
      <div className="stage-sticker-slot">
        <div className={`stage-sticker${answer ? ' is-answer' : ''}`} role={answer ? 'status' : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
