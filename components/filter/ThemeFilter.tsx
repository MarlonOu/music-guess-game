'use client';

import { CheckRow } from './CheckRow';
import type { Theme } from '../../lib/types/theme';

interface ThemeFilterProps {
  themes: Theme[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

// 篩選邏輯與模式邏輯解耦，作法比照 ArtistFilter；與歌手篩選同時使用時以交集方式套用（見 songRepository.getFiltered）
export function ThemeFilter({ themes, selectedIds, onToggle }: ThemeFilterProps) {
  if (themes.length === 0) {
    return <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>目前尚無主題資料</p>;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        maxHeight: '260px',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        paddingRight: '4px',
      }}
    >
      {themes.map((t) => (
        <CheckRow
          key={t.id}
          checked={selectedIds.includes(t.id)}
          onChange={() => onToggle(t.id)}
          label={t.name}
        />
      ))}
    </div>
  );
}
