import Link from 'next/link';
import { MatchSetupForm } from '../../components/match/MatchSetupForm';

export default function MatchSetupPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px',
        gap: '24px',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          MUSIC GUESS
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>建立比賽</h1>
      </header>

      <MatchSetupForm />

      <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
        返回首頁
      </Link>
    </main>
  );
}
