import Link from 'next/link';

/** 靜態黑膠圖：唱針抬起，表示「沒有在播放」。 */
export function StatusDisc({ label }: { label: string }) {
  return (
    <svg width="148" height="148" viewBox="0 0 148 148" fill="none" aria-hidden="true">
      <circle cx="68" cy="80" r="60" fill="#1a1b20" stroke="#26272c" strokeWidth="1.5" />
      <circle cx="68" cy="80" r="48" stroke="#26272c" />
      <circle cx="68" cy="80" r="39" stroke="#26272c" />
      <circle cx="68" cy="80" r="30" fill="#e8b93f" />
      <text
        x="68"
        y="85"
        textAnchor="middle"
        fontFamily="var(--font-ibm-plex-mono), monospace"
        fontSize="15"
        fontWeight="500"
        fill="#1a1408"
      >
        {label}
      </text>
      <circle cx="136" cy="14" r="7" fill="#8a8b93" opacity="0.5" />
      <line x1="136" y1="14" x2="128" y2="52" stroke="#8a8b93" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="128" cy="52" r="3.5" fill="#e8b93f" />
    </svg>
  );
}

export function StatusScreen({
  label,
  title,
  message,
  children,
}: {
  label: string;
  title: string;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="status-screen">
      <div className="status-screen-inner">
        <StatusDisc label={label} />
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.6rem' }}>{title}</h1>
        {message && <p style={{ color: 'var(--ink-dim)', fontSize: '0.92rem', lineHeight: 1.6 }}>{message}</p>}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>{children}</div>
      </div>
    </main>
  );
}

export function HomeLink({ primary }: { primary?: boolean }) {
  return (
    <Link href="/" className={`btn ${primary ? 'btn-primary' : 'btn-ghost'}`}>
      返回首頁
    </Link>
  );
}
