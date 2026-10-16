'use client';

import { openReportDialog } from '../../lib/client/reportBus';

/** 播放失敗時顯示在狀態文字下方，一鍵開啟回報視窗並預設為「播放問題」 */
export function PlaybackReportLink() {
  return (
    <button
      type="button"
      className="report-inline-link"
      onClick={() => openReportDialog({ category: 'playback', prefill: '這首歌無法播放：' })}
    >
      回報這個問題
    </button>
  );
}
