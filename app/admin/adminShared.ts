import type React from 'react';

// 管理頁共用的視覺樣式與小工具（page.tsx 與其他 admin 元件共用）
export const inputStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: '10px',
  border: '1px solid var(--groove)',
  background: 'var(--bg-raised)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-body)',
  fontSize: '1rem',
};

export const buttonStyle: React.CSSProperties = {
  padding: '12px 22px',
  borderRadius: '10px',
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  fontWeight: 600,
  fontSize: '0.95rem',
};

export const dangerButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: '1px solid var(--error)',
  background: 'transparent',
  color: 'var(--error)',
  fontSize: '0.85rem',
  fontWeight: 500,
};

export const editButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: '1px solid var(--groove)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: '0.85rem',
  fontWeight: 500,
};

export const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  width: '100%',
  maxWidth: '720px',
  padding: '20px',
  borderRadius: '14px',
  border: '1px solid var(--groove)',
  background: 'var(--bg-raised)',
};

export function formatDuration(sec: number): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
