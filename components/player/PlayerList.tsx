'use client';

import type { PlayerProfile } from '../../lib/types/player';

interface PlayerListProps {
  players: PlayerProfile[];
  onEdit: (profile: PlayerProfile) => void;
  onDelete: (id: string) => void;
}

export function PlayerList({ players, onEdit, onDelete }: PlayerListProps) {
  if (players.length === 0) {
    return <p style={{ color: 'var(--ink-dim)' }}>尚無對戰人別，請先新增</p>;
  }

  return (
    <ul
      style={{
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%',
        maxWidth: '480px',
      }}
    >
      {players.map((p) => (
        <li
          key={p.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderRadius: '10px',
            border: '1px solid var(--groove)',
            background: 'var(--bg-raised)',
          }}
        >
          <span>{p.displayName}</span>
          <span style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => onEdit(p)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid var(--groove)',
                background: 'transparent',
                color: 'var(--ink)',
                fontSize: '0.85rem',
              }}
            >
              編輯
            </button>
            <button
              onClick={() => onDelete(p.id)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid var(--groove)',
                background: 'transparent',
                color: 'var(--error)',
                fontSize: '0.85rem',
              }}
            >
              刪除
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
