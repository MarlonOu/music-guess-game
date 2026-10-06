'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * 速通模式「答對了、準備下一題」的過場畫面——本質上就是「換下一首歌」，這正是
 * 首頁轉盤英雄區那套視覺語言最契合的地方，所以這裡不是另外發明一套新的倒數動畫，
 * 是把同一個隱喻延伸進遊戲過程本身：倒數開始時指針抬起（這段期間沒有音樂在放，
 * 唱片也確實是靜止的，不是裝飾性的巧合），倒數最後一秒指針緩緩落下，象徵下一首歌
 * 即將開始——玩家在整個遊戲歷程裡會重複看到這個「指針起落」的動作十次（每答對一題
 * 一次），讓它成為這個模式節奏感的一部分，而不是看過一次就膩的開場噱頭。
 *
 * 唱片本體的同心溝紋背景跟 StageDisc、首頁 Turntable 是同一組
 * repeating-radial-gradient 參數，三個畫面共用同一套視覺語彙，玩家從首頁點進來、
 * 玩的過程中、到這個過場畫面，感覺得出來是同一個產品在說同一件事，不是各自獨立的
 * 局部裝飾。
 */
export function TransitionDisc({ secondsLeft }: { secondsLeft: number }) {
  const prefersReducedMotion = useReducedMotion();
  // 倒數進入最後一秒才開始放下指針——倒數開始時（這裡是「2」那一拍）指針維持抬起，
  // 讓玩家先感受到「音樂停了、靜止了」這個狀態，接著指針才緩緩落下，避免一進過場
  // 畫面就立刻開始放下指針、整個「停頓」的感覺被壓縮到幾乎感覺不到。
  const needleDown = secondsLeft <= 1;

  return (
    <div style={{ position: 'relative', width: '112px', height: '112px', flexShrink: 0 }}>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'repeating-radial-gradient(circle, var(--groove) 0px, var(--groove) 2px, var(--bg-raised) 2px, var(--bg-raised) 5px)',
          border: '2px solid var(--groove)',
        }}
      />

      {/* 倒數數字，每次數字變化都用 key 讓 Framer Motion 當成全新元素重新進場，
          做出一個小小的「跳拍」縮放效果，呼應倒數本身一拍一拍的節奏感。 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <motion.span
          key={secondsLeft}
          initial={prefersReducedMotion ? false : { scale: 1.35, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '2.4rem',
            color: 'var(--accent)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {secondsLeft}
        </motion.span>
      </div>

      {/* 指針：跟首頁 Turntable 同一套座標邏輯（軸心在右上方、指針指向唱片邊緣），
          縮小比例套用在這個較小的尺寸上。抬起角度跟首頁的停靠角度相同（-28deg），
          維持同一個「指針的中性位置長什麼樣」的視覺記憶。 */}
      <motion.div
        aria-hidden="true"
        initial={false}
        animate={{ rotate: needleDown ? 0 : -28 }}
        transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.6, ease: [0.34, 1.1, 0.64, 1] }}
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
