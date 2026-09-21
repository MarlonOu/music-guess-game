'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';

interface ModeDef {
  href: string;
  title: string;
  desc: string;
  tag?: string;
}

const MODES: ModeDef[] = [
  { href: '/match-setup', title: '單機模式', desc: '一個人，自己出題自己猜' },
  { href: '/online', title: '線上模式', desc: '開房間，跟朋友一起搶答' },
  { href: '/speedrun', title: '速通挑戰', desc: '碼表計時，衝上排行榜', tag: '限時競速' },
];

/** 單機模式：播放鍵，呼吸般的光暈脈動——「按下去就開始」的邀請感 */
function SoloIcon({ animate }: { animate: boolean }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <motion.circle
        cx="20"
        cy="20"
        r="17"
        stroke="var(--accent)"
        strokeWidth="1.5"
        style={{ transformOrigin: '20px 20px' }}
        animate={animate ? { scale: [1, 1.1, 1], opacity: [0.35, 0.85, 0.35] } : undefined}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path d="M16.5 13.5L27 20L16.5 26.5V13.5Z" fill="var(--accent)" />
    </svg>
  );
}

/** 線上模式：從中心點向外擴散的訊號環，呼應「開房間、找朋友」的廣播意象 */
function OnlineIcon({ animate }: { animate: boolean }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="3" fill="var(--accent)" />
      {[0, 0.7].map((delay) => (
        <motion.circle
          key={delay}
          cx="20"
          cy="20"
          r="6"
          stroke="var(--accent)"
          strokeWidth="1.5"
          fill="none"
          style={{ transformOrigin: '20px 20px' }}
          initial={{ opacity: 0.7, scale: 1 }}
          animate={animate ? { opacity: [0.7, 0], scale: [1, 2.6] } : undefined}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay }}
        />
      ))}
    </svg>
  );
}

/** 速通挑戰：碼表秒針持續繞圈——三個模式裡唯一「跟時間賽跑」的玩法，用秒針動作直接點題 */
function SpeedrunIcon({ animate }: { animate: boolean }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <line x1="16" y1="4" x2="24" y2="4" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="20" y1="4" x2="20" y2="7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="20" cy="22" r="15" stroke="var(--accent)" strokeWidth="1.5" />
      <motion.line
        x1="20"
        y1="22"
        x2="20"
        y2="11"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        style={{ transformOrigin: '20px 22px' }}
        animate={animate ? { rotate: 360 } : undefined}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}
      />
    </svg>
  );
}

const ICONS = [SoloIcon, OnlineIcon, SpeedrunIcon];

export default function Home() {
  const prefersReducedMotion = useReducedMotion();
  const animateLoops = !prefersReducedMotion;

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
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        style={{ textAlign: 'center' }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.3rem' }}>音樂猜歌</h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', marginTop: '8px' }}>聽一段音樂，猜出是哪一首</p>
      </motion.div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '420px' }}>
        {MODES.map((m, i) => {
          const Icon = ICONS[i];
          return (
            <motion.div
              key={m.href}
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.98 }}
              className="home-mode-card"
              style={{
                borderRadius: '18px',
                border: '1px solid var(--groove)',
                background: 'var(--bg-raised)',
              }}
            >
              <Link
                href={m.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '18px',
                  padding: '20px',
                }}
              >
                <Icon animate={animateLoops} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>{m.title}</span>
                  <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>{m.desc}</span>
                  {m.tag && (
                    <span
                      style={{
                        marginTop: '4px',
                        width: 'fit-content',
                        padding: '3px 10px',
                        borderRadius: '999px',
                        border: '1px solid var(--accent)',
                        color: 'var(--accent)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.72rem',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {m.tag}
                    </span>
                  )}
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
      >
        <Link href="/admin" prefetch={false} style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', fontStyle: 'italic' }}>
          資料庫管理（歌手／歌曲）
        </Link>
      </motion.div>
    </main>
  );
}
