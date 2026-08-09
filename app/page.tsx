import Link from 'next/link';

const modes = [
  { href: '/intro', label: '前奏猜歌', code: 'INTRO' },
  { href: '/random-clip', label: '隨機片段猜歌', code: 'RANDOM_CLIP' },
  { href: '/lyric-line', label: '歌詞猜歌', code: 'LYRIC_LINE' },
];

export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '40px',
        padding: '24px',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          MUSIC GUESS GAME
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', marginTop: '8px' }}>
          音樂猜歌
        </h1>
      </div>

      <Link
        href="/match-setup"
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '16px 24px',
          borderRadius: '14px',
          border: 'none',
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          fontWeight: 600,
          fontSize: '1.05rem',
          width: '100%',
          maxWidth: '360px',
        }}
      >
        建立比賽
      </Link>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '360px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem' }}>或直接單機快速開始：</span>
        {modes.map((m) => (
          <Link
            key={m.code}
            href={m.href}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '20px 24px',
              borderRadius: '14px',
              border: '1px solid var(--groove)',
              background: 'var(--bg-raised)',
            }}
          >
            <span style={{ fontSize: '1.125rem' }}>{m.label}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', fontSize: '0.75rem' }}>
              {m.code}
            </span>
          </Link>
        ))}
      </nav>

      <Link
        href="/players"
        style={{
          color: 'var(--ink-dim)',
          fontSize: '0.9rem',
          textDecoration: 'underline',
        }}
      >
        對戰人別管理
      </Link>

      <Link
        href="/admin"
        style={{
          color: 'var(--ink-dim)',
          fontSize: '0.9rem',
          textDecoration: 'underline',
        }}
      >
        資料庫管理（歌手／歌曲）
      </Link>
    </main>
  );
}
