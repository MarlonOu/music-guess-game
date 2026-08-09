'use client';

import { useState, FormEvent } from 'react';
import type { PlayerProfile } from '../../lib/types/player';

interface PlayerProfileFormProps {
  editingProfile: PlayerProfile | null;
  onSubmit: (displayName: string) => void;
  onCancelEdit: () => void;
}

// 呼叫端須在 editingProfile 切換（含清除為 null）時，
// 以 key={editingProfile?.id ?? 'new'} 掛載本元件，確保初始值正確重置。
export function PlayerProfileForm({ editingProfile, onSubmit, onCancelEdit }: PlayerProfileFormProps) {
  const [displayName, setDisplayName] = useState(editingProfile?.displayName ?? '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
    if (!editingProfile) setDisplayName('');
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', gap: '8px', width: '100%', maxWidth: '480px' }}
    >
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="輸入顯示名稱"
        maxLength={20}
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
        style={{
          padding: '12px 20px',
          borderRadius: '10px',
          border: 'none',
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          fontWeight: 600,
        }}
      >
        {editingProfile ? '儲存' : '新增'}
      </button>
      {editingProfile && (
        <button
          type="button"
          onClick={onCancelEdit}
          style={{
            padding: '12px 20px',
            borderRadius: '10px',
            border: '1px solid var(--groove)',
            background: 'transparent',
            color: 'var(--ink-dim)',
            fontWeight: 600,
          }}
        >
          取消
        </button>
      )}
    </form>
  );
}
