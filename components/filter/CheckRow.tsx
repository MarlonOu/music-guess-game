'use client';

interface CheckRowProps {
  checked: boolean;
  onChange: () => void;
  label: string;
}

/** 自繪勾選列：保留原生 checkbox（鍵盤與讀屏），視覺由 .check-row 負責。 */
export function CheckRow({ checked, onChange, label }: CheckRowProps) {
  return (
    <label className={`check-row${checked ? ' is-checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="check-box" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="m2.5 6.2 2.4 2.4 4.6-5" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{label}</span>
    </label>
  );
}
