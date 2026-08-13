import Link from 'next/link';

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
        單機模式
      </Link>

      <Link
        href="/online"
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '16px 24px',
          borderRadius: '14px',
          border: '1px solid var(--accent)',
          background: 'transparent',
          color: 'var(--accent)',
          fontWeight: 600,
          fontSize: '1.05rem',
          width: '100%',
          maxWidth: '360px',
        }}
      >
        線上模式
      </Link>

      <Link
        href="/admin"
        prefetch={false}
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
