'use client';

import { useState, FormEvent } from 'react';

interface AnswerInputProps {
  disabled: boolean;
  onSubmit: (answer: string) => void;
}

export function AnswerInput({ disabled, onSubmit }: AnswerInputProps) {
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled || value.trim().length === 0) return;
    onSubmit(value);
    setValue('');
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', gap: '8px', width: '100%', maxWidth: '480px' }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="輸入歌名"
        style={{
          flex: 1,
          padding: '12px 16px',
          borderRadius: '10px',
          border: '1px solid var(--groove)',
          background: 'var(--bg-raised)',
          color: 'var(--ink)',
          fontSize: '1rem',
        }}
      />
      <button
        type="submit"
        disabled={disabled}
        style={{
          padding: '12px 20px',
          borderRadius: '10px',
          border: 'none',
          background: disabled ? 'var(--groove)' : 'var(--accent)',
          color: disabled ? 'var(--ink-dim)' : 'var(--accent-ink)',
          fontWeight: 600,
        }}
      >
        送出
      </button>
    </form>
  );
}
