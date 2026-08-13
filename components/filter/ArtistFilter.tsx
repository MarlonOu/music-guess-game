'use client';

import type { Artist } from '../../lib/types/theme';

interface ArtistFilterProps {
  artists: Artist[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

// 篩選邏輯與模式邏輯解耦：本元件只負責「選了哪些歌手」，
// 不感知目前是哪個 GameMode，任一模式皆可套用同一份篩選結果（見 01-project-overview.md）。
export function ArtistFilter({ artists, selectedIds, onToggle }: ArtistFilterProps) {
  if (artists.length === 0) {
    return <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>目前題庫尚無歌手資料</p>;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        // 固定列高、超出可滑動：避免歌手清單一長，篩選區塊把整個頁面往下撐得很長，
        // 尤其線上模式的房間 lobby 頁面下面還有聊天室要顯示，清單本身要能收在固定高度內。
        maxHeight: '260px',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        paddingRight: '4px',
      }}
    >
      {artists.map((a) => (
        <label
          key={a.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid var(--groove)',
            background: selectedIds.includes(a.id) ? 'var(--bg-raised)' : 'transparent',
            flexShrink: 0,
          }}
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(a.id)}
            onChange={() => onToggle(a.id)}
          />
          <span>{a.name}</span>
        </label>
      ))}
    </div>
  );
}
