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
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.75rem' }}>建立比賽</h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.88rem' }}>選一個模式，挑選題庫，馬上開始</p>
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
