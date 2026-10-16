import { REPORT_CATEGORIES } from '../types/report';
import type { ClientLogEntry, LogPrimitive } from '../types/report';

export const MAX_LOG_ENTRIES = 400;
const LOG_TYPES = new Set(['nav', 'click', 'net', 'audio', 'console', 'error', 'game', 'env']);
const CATEGORY_SET = new Set<string>(REPORT_CATEGORIES.map((c) => c.value));

export function cleanText(v: unknown, max: number, keepNewlines = false): string {
  if (typeof v !== 'string') return '';
  const noCtl = keepNewlines
    ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ').replace(/\r\n?/g, '\n')
    : v.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ');
  return noCtl.trim().slice(0, max);
}

export function isCategory(v: unknown): v is string {
  return typeof v === 'string' && CATEGORY_SET.has(v);
}

function prim(v: unknown): LogPrimitive | undefined {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return cleanText(v, 160);
  return undefined;
}

export function sanitizeEnv(raw: unknown): Record<string, LogPrimitive> {
  const out: Record<string, LogPrimitive> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 30)) {
    const p = prim(v);
    if (p !== undefined) out[cleanText(k, 40)] = p;
  }
  return out;
}

export function sanitizeLogs(raw: unknown): ClientLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientLogEntry[] = [];
  for (const item of raw.slice(-MAX_LOG_ENTRIES)) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.t !== 'number' || !Number.isFinite(e.t)) continue;
    if (typeof e.type !== 'string' || !LOG_TYPES.has(e.type)) continue;
    const entry: ClientLogEntry = {
      t: Math.round(e.t),
      type: e.type as ClientLogEntry['type'],
      msg: cleanText(e.msg, 300),
    };
    if (e.lvl === 'w' || e.lvl === 'e') entry.lvl = e.lvl;
    if (e.data && typeof e.data === 'object' && !Array.isArray(e.data)) {
      const d: Record<string, LogPrimitive> = {};
      for (const [k, v] of Object.entries(e.data as Record<string, unknown>).slice(0, 12)) {
        const p = prim(v);
        if (p !== undefined) d[cleanText(k, 40)] = p;
      }
      if (Object.keys(d).length > 0) entry.data = d;
    }
    out.push(entry);
  }
  return out;
}

export function countErrors(logs: ClientLogEntry[]): number {
  return logs.filter((l) => l.lvl === 'e' || l.type === 'error').length;
}
