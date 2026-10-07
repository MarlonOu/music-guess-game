'use client';

interface LeaderboardEntryBase {
  id: string;
  displayName: string;
}

/** 速通與無限連勝共用的排行榜清單；成績欄位的顯示方式由 formatValue 決定。 */
export function LeaderboardList<T extends LeaderboardEntryBase>({
  entries,
  highlightId,
  formatValue,
}: {
  entries: T[];
  highlightId?: string;
  formatValue: (entry: T) => React.ReactNode;
}) {
  if (entries.length === 0) {
    return <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', textAlign: 'center' }}>目前還沒有人上榜，當第一個吧！</p>;
  }
  return (
    <ol
      style={{
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        maxHeight: '360px',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        width: '100%',
      }}
    >
      {entries.map((entry, i) => {
        const rank = i + 1;
        const isTopThree = rank <= 3;
        return (
          <li
            key={entry.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: '8px',
              background: entry.id === highlightId ? 'var(--bg-raised)' : 'transparent',
              border: entry.id === highlightId ? '1px solid var(--accent)' : '1px solid transparent',
              fontSize: '0.9rem',
            }}
          >
            {/* 排名跟姓名分開兩個獨立元素，不用「N. 」這種句點接法——這是密集的百人排行榜，
                每一列資訊量要壓到最小，但排名本身還是該有自己獨立的欄位寬度跟字體（等寬
                數字字體），不要讓它看起來只是姓名前面黏著的一個字元。前三名排名刻意用
                金色，給這個長長的清單一點點節奏感，不是每一列都长得一模一樣。 */}
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span
                style={{
                  width: '22px',
                  flexShrink: 0,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  fontWeight: isTopThree ? 700 : 400,
                  color: isTopThree ? 'var(--accent)' : 'var(--ink-dim)',
                }}
              >
                {rank}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.displayName}</span>
            </span>
            <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
              {formatValue(entry)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
