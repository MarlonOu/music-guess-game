interface TimerProps {
  remainingSec: number;
  totalSec: number;
}

export function Timer({ remainingSec, totalSec }: TimerProps) {
  const ratio = totalSec > 0 ? Math.max(0, Math.min(1, remainingSec / totalSec)) : 0;
  const low = remainingSec <= 5;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div
        style={{
          width: '120px',
          height: '6px',
          background: 'var(--groove)',
          borderRadius: '999px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${ratio * 100}%`,
            height: '100%',
            background: low ? 'var(--error)' : 'var(--accent)',
            transition: 'width 1s linear, background 0.3s ease',
          }}
        />
      </div>
      <span
        style={{
          color: low ? 'var(--error)' : 'var(--ink-dim)',
          fontSize: '0.875rem',
          minWidth: '2.5ch',
        }}
      >
        {remainingSec}s
      </span>
    </div>
  );
}
