/**
 * 客戶端操作／系統紀錄（環形緩衝區）。
 *
 * 目的：使用者按下「回報問題」時，自動把最近發生的事一併送給管理者，協助重現問題。
 * 隱私原則：只記「發生了什麼」，不記「輸入了什麼」——不記錄任何輸入框內容、請求／回應本文、
 * 驗證用 token（網址查詢參數只保留白名單）；點擊只記按鈕的文字／標籤。
 * 緩衝區上限 MAX_ENTRIES 筆，並以 sessionStorage 暫存（同一分頁重新整理後仍保留），
 * 所有存取都包 try/catch，隱私模式或無痕視窗讀寫失敗時退回純記憶體。
 */
import type { ClientLogEntry, LogPrimitive, LogType } from '../types/report';

const MAX_ENTRIES = 300;
const MAX_MSG = 240;
const STORAGE_KEY = 'client-log-v1';
/** 網址查詢參數白名單：其餘一律丟棄（避免把 token 等敏感值寫進紀錄） */
const QUERY_ALLOW = new Set(['q', 's', 'k', 'page', 'status', 'country']);

let buffer: ClientLogEntry[] = [];
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const pageStartedAt = typeof performance !== 'undefined' ? Date.now() - performance.now() : Date.now();

function load(): void {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) buffer = parsed.slice(-MAX_ENTRIES);
    }
  } catch {
    // 讀不到就從空的緩衝區開始
  }
}

function scheduleSave(): void {
  if (typeof window === 'undefined' || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, 600);
}

function flush(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    // 空間不足或被禁用：忽略
  }
}

function clip(s: string, max = MAX_MSG): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function cleanData(data?: Record<string, unknown>): Record<string, LogPrimitive> | undefined {
  if (!data) return undefined;
  const out: Record<string, LogPrimitive> = {};
  for (const [k, v] of Object.entries(data).slice(0, 12)) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = clip(v, 120);
    else if (v !== undefined) out[k] = clip(String(v), 120);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 寫入一筆紀錄；伺服器端呼叫會被忽略 */
export function logEvent(
  type: LogType,
  msg: string,
  data?: Record<string, unknown>,
  lvl?: 'w' | 'e'
): void {
  if (typeof window === 'undefined') return;
  load();
  const entry: ClientLogEntry = { t: Date.now(), type, msg: clip(msg) };
  if (lvl) entry.lvl = lvl;
  const d = cleanData(data);
  if (d) entry.data = d;
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  scheduleSave();
}

export function getLogSnapshot(): ClientLogEntry[] {
  load();
  return buffer.slice();
}

/** 網址去敏：同源只留路徑與白名單參數；外部網址只留主機與路徑 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return `${u.host}${u.pathname}`;
    const kept: string[] = [];
    u.searchParams.forEach((v, k) => {
      if (QUERY_ALLOW.has(k)) kept.push(`${k}=${clip(v, 24)}`);
    });
    return u.pathname + (kept.length ? `?${kept.join('&')}` : '');
  } catch {
    return clip(raw, 80);
  }
}

function describeTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('button, a, [role="button"], [role="tab"], summary, label, input, select, textarea');
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    // 只記欄位本身的標籤，絕不記內容
    const type = el.getAttribute('type') || '';
    const label = aria || el.getAttribute('name') || el.id || el.getAttribute('placeholder') || '';
    return `${tag}${type ? `[${type}]` : ''} ${clip(label, 40)}`.trim();
  }
  const text = aria || (el as HTMLElement).innerText || el.textContent || '';
  const label = clip(text.replace(/\s+/g, ' ').trim(), 40);
  if (tag === 'a') {
    const href = el.getAttribute('href') || '';
    return `連結「${label}」→ ${clip(href.split('?')[0], 60)}`;
  }
  return `${tag === 'button' ? '按鈕' : tag}「${label}」`;
}

function stringify(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

declare global {
  interface Window {
    __clientLogInstalled?: boolean;
  }
}

/** 安裝全域擷取（點擊、錯誤、未處理 Promise、console、fetch、連線狀態）；重複呼叫無副作用 */
export function installGlobalCapture(): void {
  if (typeof window === 'undefined' || window.__clientLogInstalled) return;
  window.__clientLogInstalled = true;
  load();
  logEvent('nav', `載入頁面 ${window.location.pathname}`, { visibility: document.visibilityState });

  window.addEventListener(
    'click',
    (e) => {
      const d = describeTarget(e.target);
      if (d) logEvent('click', d);
    },
    true
  );

  window.addEventListener('error', (e) => {
    // 資源載入失敗（<audio>／<img>／<script>）不會冒泡，要在捕獲階段才收得到
    const t = e.target;
    if (t && t !== window && t instanceof Element) {
      const src = (t as HTMLMediaElement).currentSrc || t.getAttribute('src') || '';
      logEvent('error', `資源載入失敗 <${t.tagName.toLowerCase()}> ${redactUrl(src)}`, undefined, 'e');
      return;
    }
    logEvent('error', `未捕捉的錯誤：${e.message}`, { at: `${(e.filename || '').split('/').pop()}:${e.lineno}` }, 'e');
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    logEvent('error', `未處理的 Promise 錯誤：${stringify(e.reason)}`, undefined, 'e');
  });

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        logEvent('console', args.map(stringify).join(' '), undefined, level === 'error' ? 'e' : 'w');
      } catch {
        // 記錄失敗不影響原本的 console 輸出
      }
      original(...args);
    };
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : '') || 'GET').toUpperCase();
    // 回報本身與紀錄無關，避免回報送出的請求污染下一次的紀錄
    if (rawUrl.includes('/api/reports')) return originalFetch(input, init);
    const url = redactUrl(rawUrl);
    const started = performance.now();
    try {
      const res = await originalFetch(input, init);
      const ms = Math.round(performance.now() - started);
      logEvent('net', `${method} ${url} → ${res.status}`, { ms }, res.status >= 500 ? 'e' : res.status >= 400 ? 'w' : undefined);
      return res;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        logEvent('net', `${method} ${url} 已取消`, { ms: Math.round(performance.now() - started) });
      } else {
        logEvent('net', `${method} ${url} 連線失敗：${stringify(err)}`, { ms: Math.round(performance.now() - started) }, 'e');
      }
      throw err;
    }
  };

  window.addEventListener('online', () => logEvent('env', '網路已恢復連線'));
  window.addEventListener('offline', () => logEvent('env', '網路中斷', undefined, 'w'));
  document.addEventListener('visibilitychange', () => {
    logEvent('env', document.visibilityState === 'hidden' ? '頁面進入背景' : '頁面回到前景');
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

type NavigatorWithConnection = Navigator & { connection?: { effectiveType?: string; saveData?: boolean } };

/** 回報當下的裝置與環境資訊 */
export function collectEnvironment(): Record<string, LogPrimitive> {
  if (typeof window === 'undefined') return {};
  const nav = navigator as NavigatorWithConnection;
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // 忽略
  }
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    reportedAt: Date.now(),
    pageAgeSec: Math.round((Date.now() - pageStartedAt) / 1000),
    language: navigator.language,
    platform: navigator.platform || '',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height}`,
    dpr: window.devicePixelRatio,
    online: navigator.onLine,
    connection: nav.connection?.effectiveType ?? '',
    saveData: nav.connection?.saveData ?? false,
    timezone: tz,
    standalone: Boolean(standalone),
    visibility: document.visibilityState,
    youtubeApiLoaded: Boolean((window as unknown as { YT?: unknown }).YT),
    touch: navigator.maxTouchPoints > 0,
  };
}
