'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';

interface PageShellProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  width?: number;
  showBack?: boolean;
  children: React.ReactNode;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** 所有內頁共用的外殼：返回導覽、標題區、內容寬度、安全區。 */
export function PageShell({
  title,
  subtitle,
  backHref = '/',
  backLabel = '首頁',
  width = 480,
  showBack = true,
  children,
}: PageShellProps) {
  const reduce = useReducedMotion();
  const rise = (delay: number) =>
    reduce
      ? { initial: false as const }
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay, ease: EASE },
        };

  return (
    <main className="shell">
      <div className="shell-inner" style={{ maxWidth: width }}>
        <nav className="shell-nav" aria-label="頁面導覽">
          {showBack && (
            <Link href={backHref} className="shell-back">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {backLabel}
            </Link>
          )}
        </nav>

        <motion.header {...rise(0)} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 'clamp(1.75rem, 7vw, 2.25rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.92rem', lineHeight: 1.6 }}>{subtitle}</p>
          )}
        </motion.header>

        <motion.div {...rise(0.08)} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {children}
        </motion.div>
      </div>
    </main>
  );
}
