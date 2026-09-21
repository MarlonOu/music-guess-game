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
        className="field"
        style={{ flex: 1 }}
      />
      <button type="submit" className="btn btn-primary">
        {editingProfile ? '儲存' : '新增'}
      </button>
      {editingProfile && (
        <button type="button" onClick={onCancelEdit} className="btn btn-ghost">
          取消
        </button>
      )}
    </form>
  );
}
