'use client';

import { useEffect, useState } from 'react';

/**
 * 臨時除錯用的「螢幕上主控台」——把 console.log/warn/error 跟未被接住的例外／
 * Promise rejection，直接顯示在畫面上一塊固定區塊裡，不需要任何遠端偵錯工具就能
 * 在手機上直接看到、截圖。
 *
 * 這是為了排查「速通模式在手機上卡住、需要切換 App 才能繼續」這個問題臨時加的——
 * 沒有 Mac 就沒辦法用 Safari 遠端偵錯 iOS 裝置（這是 Apple 的限制，Windows 上的
 * 任何瀏覽器都做不到），這個元件是唯一能在「不需要額外工具」的前提下，把手機瀏覽器
 * 實際發生的錯誤／警告直接攤在使用者眼前的辦法。
 *
 * 用 URL 參數 ?debug=1 才會啟用，不會影響一般玩家的畫面——這個元件只是暫時拿來
 * 排查問題用的，確認問題解決後應該整個移除（連同這個檔案跟頁面裡的呼叫）。
 */
interface LogEntry {
  id: number;
  time: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

let nextId = 0;

export function OnScreenConsole() {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  // 一定要用 effect（掛載後）才能讀 window.location.search，不能直接在 render 時讀、
  // 也不能用 useState 的惰性初始化——這個元件是 'use client'，仍然會先在伺服器端
  // 渲染一次（這時候沒有 window，只能先假設 false），再到瀏覽器端「hydrate」接手。
  // 如果初始 state 用惰性初始化直接讀 window.location.search，伺服器端（永遠 false）
  // 跟瀏覽器端第一次渲染（如果網址真的有 ?debug=1 就會是 true）兩次渲染結果會對不起來，
  // 觸發 React 的 hydration mismatch，這個除錯用的面板在這種情況下可能顯示不穩定，
  // 剛好是這個工具最不該發生的事。改成統一先渲染 false（跟伺服器端一致），
  // 掛載完成後才在 effect 裡讀取真正的網址參數並更新，是 React 官方建議的標準寫法。
  useEffect(() => {
    // 讀取瀏覽器專屬的 window.location 必須等到掛載後才能安全進行，上面已經解釋過
    // 為什麼不能用 useState 的惰性初始化取代（避免 SSR/hydration 不一致），這是
    // React 官方建議的標準寫法。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(new URLSearchParams(window.location.search).get('debug') === '1');
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function push(level: LogEntry['level'], args: unknown[]) {
      const message = args
        .map((a) => {
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          if (typeof a === 'object') {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return String(a);
        })
        .join(' ');
      const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
      setEntries((prev) => [...prev.slice(-99), { id: nextId++, time, level, message }]);
    }

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = (...args: unknown[]) => {
      push('log', args);
      originalLog(...args);
    };
    console.warn = (...args: unknown[]) => {
      push('warn', args);
      originalWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      push('error', args);
      originalError(...args);
    };

    // 未被接住的例外／Promise rejection 特別重要——「卡住但完全沒有任何錯誤訊息」
    // 本身就是很關鍵的線索（代表卡住的地方可能連錯誤都沒有拋出，問題出在別的地方，
    // 例如單純的 Promise 一直不 settle），這裡確保這兩種情況也會被記錄下來。
    function handleError(event: ErrorEvent) {
      push('error', [`[未接住的例外] ${event.message}`, event.filename ? `@${event.filename}:${event.lineno}` : '']);
    }
    function handleRejection(event: PromiseRejectionEvent) {
      push('error', ['[未接住的 Promise rejection]', event.reason]);
    }
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    push('log', ['[OnScreenConsole] 已啟用，開始記錄']);

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [enabled]);

  if (!enabled) return null;

  const levelColor: Record<LogEntry['level'], string> = {
    log: '#9ca3af',
    warn: '#f59e0b',
    error: '#ef4444',
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        maxHeight: collapsed ? '36px' : '45vh',
        overflow: 'hidden',
        background: 'rgba(10, 10, 15, 0.95)',
        borderTop: '2px solid #f59e0b',
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#e5e7eb',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 10px',
          borderBottom: collapsed ? 'none' : '1px solid #374151',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>🐛 除錯主控台（{entries.length}）</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setEntries([])}
            style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px' }}
          >
            清除
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px' }}
          >
            {collapsed ? '展開 ▲' : '收起 ▼'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div style={{ overflowY: 'auto', padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {entries.length === 0 && <span style={{ color: '#6b7280' }}>還沒有任何記錄……</span>}
          {entries.map((e) => (
            <div key={e.id} style={{ color: levelColor[e.level], wordBreak: 'break-all' }}>
              <span style={{ color: '#6b7280' }}>[{e.time}]</span> {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
