'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * 首頁英雄區：會下針的轉盤。
 * 載入時演出一次「下針」：指針落下的瞬間，唱片開始轉動、標題浮現。
 * 之後指針會跟著游標／焦點所在的曲目列，停在對應的音軌位置（A1~A4 四條溝）。
 * 中心貼紙不隨唱片旋轉，維持文字可讀。
 */

/** 三個音軌對應的指針角度（由外圈到內圈）。 */
const TRACK_NEEDLE_ANGLES = [-28, -19, -9, 0];
const REST_ANGLE = -13;

interface TurntableProps {
  activeTrack?: number | null;
  /** 唱片直徑，任何 CSS 長度（可為 var()）。 */
  size?: string;
}

export function Turntable({ activeTrack = null, size = 'clamp(220px, 58vw, 360px)' }: TurntableProps) {
  const reduce = useReducedMotion();
  const skip = Boolean(reduce);
  const [landed, setLanded] = useState(skip);

  const needleAngle = activeTrack == null ? REST_ANGLE : TRACK_NEEDLE_ANGLES[activeTrack] ?? REST_ANGLE;
  // 進場動畫期間用原本的 tween；落下之後改用彈簧，讓指針追蹤游標有重量感。
  const needleTransition = skip
    ? { duration: 0.01 }
    : landed
      ? { type: 'spring' as const, stiffness: 150, damping: 17, mass: 0.8 }
      : { duration: 0.8, ease: [0.34, 1.1, 0.64, 1] as const, delay: 0.15 };

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <motion.div
        aria-hidden="true"
        initial={skip ? false : { opacity: 0, scale: 0.92 }}
        animate={skip ? { opacity: 1, scale: 1 } : { opacity: 1, scale: 1, rotate: 360 }}
        transition={
          skip
            ? { duration: 0.01 }
            : {
                opacity: { duration: 0.5, ease: 'easeOut' },
                scale: { duration: 0.5, ease: 'easeOut' },
                // 0.95s = 指針進場 delay 0.15 + duration 0.8，落下瞬間三件事同步。
                rotate: { duration: 24, repeat: Infinity, ease: 'linear', delay: 0.95 },
              }
        }
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'repeating-radial-gradient(circle at center, #1a1b20 0px, #1a1b20 2px, #202126 2px, #202126 4px)',
          boxShadow: '0 18px 48px -16px rgba(0, 0, 0, 0.6), inset 0 0 0 1px var(--groove)',
        }}
      />

      {/* 固定不轉的反光層：唱片轉動時光澤不跟著轉，才有「實體反光」的感覺 */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          pointerEvents: 'none',
          background:
            'conic-gradient(from 20deg, transparent 0deg, rgba(255,255,255,0.05) 28deg, transparent 62deg, transparent 180deg, rgba(255,255,255,0.04) 208deg, transparent 242deg)',
        }}
      />

      {/* 中心貼紙：外層 flex 負責置中，只有內層做 scale，避免 Framer Motion 覆蓋 transform 而跑位 */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <motion.div
          initial={skip ? false : { opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={skip ? { duration: 0.01 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.95 }}
          style={{
            width: '42%',
            height: '42%',
            borderRadius: '50%',
            background: 'var(--accent)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4%',
            boxShadow: '0 4px 16px -4px rgba(0, 0, 0, 0.5)',
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: `calc(${size} * 0.058)`,
              color: 'var(--accent-ink)',
              lineHeight: 1.15,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            音樂猜歌
          </h1>
          <div
            style={{
              width: '10%',
              height: '10%',
              minWidth: '7px',
              minHeight: '7px',
              borderRadius: '50%',
              background: 'var(--accent-ink)',
              opacity: 0.35,
            }}
          />
        </motion.div>
      </div>

      <motion.div
        aria-hidden="true"
        initial={skip ? false : { rotate: -28 }}
        animate={{ rotate: needleAngle }}
        transition={needleTransition}
        onAnimationComplete={() => setLanded(true)}
        style={{
          position: 'absolute',
          top: '-6%',
          right: '-10%',
          width: '46%',
          height: '46%',
          transformOrigin: '88% 12%',
        }}
      >
        <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          <circle cx="88" cy="12" r="7" fill="var(--ink-dim)" opacity="0.5" />
          <circle cx="88" cy="12" r="3.2" fill="var(--bg-raised)" />
          <line x1="88" y1="12" x2="22" y2="78" stroke="var(--ink-dim)" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="22" cy="78" r="4" fill="var(--accent)" />
        </svg>
      </motion.div>
    </div>
  );
}
