'use client';

import './globals.css';
import { StatusScreen } from '../components/layout/StatusScreen';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-Hant">
      <body>
        <StatusScreen label="!" title="發生嚴重錯誤" message="整個應用程式無法載入。重新載入通常可以解決。">
          <button type="button" onClick={reset} className="btn btn-primary">
            重新載入
          </button>
        </StatusScreen>
      </body>
    </html>
  );
}
