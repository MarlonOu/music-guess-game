'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
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
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}
      >
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          MUSIC GUESS
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>建立比賽</h1>
      </motion.header>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
        style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
      >
        <MatchSetupForm />
      </motion.div>

      <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
        返回首頁
      </Link>
    </main>
  );
}
