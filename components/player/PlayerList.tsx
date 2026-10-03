'use client';

import type { PlayerProfile } from '../../lib/types/player';
import { PlayerIdentity } from '../game/PlayerBadges';

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
          {/* 這裡管理的就是計分畫面、準備室玩家名單裡出現的同一批玩家資料，用同一套
              PlayerIdentity（色點＋姓名）呈現，玩家在這裡新增/編輯資料時，看到的色點
              就是之後遊戲中會看到的同一個顏色——整站對「這是誰」這件事只有一套視覺
              表示法，不會有「管理頁長一個樣子、遊戲裡又長另一個樣子」的落差。 */}
          <PlayerIdentity id={p.id} name={p.displayName} />
          <span style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button onClick={() => onEdit(p)} className="btn btn-ghost btn-sm">
              編輯
            </button>
            <button onClick={() => onDelete(p.id)} className="btn btn-danger btn-sm">
              刪除
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
