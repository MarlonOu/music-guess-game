'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * 首頁英雄區：一台會下針的轉盤，不是裝飾性插圖。
 *
 * 核心概念：這整個網站的玩法核心是「聽一段音樂、認出是哪一首」——類比到黑膠唱片，
 * 就是「指針落下、唱針接觸溝紋的那一刻，音樂開始」。頁面載入時只演出這一個動作一次：
 * 指針從停靠位置擺入、落在唱片上，落下的瞬間唱片才開始轉動、標題才浮現——視覺上
 * 讓「下針」成為「音樂（這個網站）開始」的理由，不是兩個互不相干的動畫湊在一起。
 * 這之後整個轉盤只剩下緩速、持續的旋轉，刻意安靜，不會有其他搶戲的動效。
 *
 * 中心貼紙（標題所在處）刻意不隨外圈唱片旋轉——這是黑膠在視覺設計上常見的簡化
 * （真實黑膠的中心貼紙其實會跟著轉），但文字持續旋轉會難以閱讀，這裡優先考慮
 * 網頁上的可讀性，用兩個獨立疊放的圖層達成「溝紋在轉、文字維持端正」的效果，
 * 而不是遷就物理上的寫實。
 */
export function Turntable() {
  const prefersReducedMotion = useReducedMotion();
  const skipSequence = Boolean(prefersReducedMotion);

  return (
    <div
      style={{
        position: 'relative',
        width: 'clamp(220px, 58vw, 360px)',
        height: 'clamp(220px, 58vw, 360px)',
        flexShrink: 0,
      }}
    >
      {/* 唱片本體：同心溝紋用 repeating-radial-gradient 畫出，比真的疊很多圈 SVG
          圓圈輕量很多，持續緩速旋轉（24 秒一圈，刻意很慢——這是背景環境感的旋律，
          不是搶戲的動效）。減少動態效果時，直接跳過旋轉與下針兩個動作，唱片、
          指針都直接呈現「已經下針、正在播放」的最終靜止狀態，玩家不會看到
          唱片真的在轉，但也不會因為完全沒有動畫而顯得像壞掉的圖片。 */}
      <motion.div
        aria-hidden="true"
        initial={skipSequence ? false : { opacity: 0, scale: 0.92 }}
        animate={
          skipSequence
            ? { opacity: 1, scale: 1 }
            : { opacity: 1, scale: 1, rotate: 360 }
        }
        transition={
          skipSequence
            ? { duration: 0.01 }
            : {
                opacity: { duration: 0.5, ease: 'easeOut' },
                scale: { duration: 0.5, ease: 'easeOut' },
                // 0.95 秒不是隨便抓的數字：下面指針動畫是 delay 0.15s + duration 0.8s，
                // 落下的瞬間剛好是 0.95s，這裡的唱片旋轉、下面中心貼紙的淡入都卡在
                // 同一個時間點觸發，三個動作在這一瞬間同時發生，才會讓人感覺到
                //「指針落下」跟「音樂開始、標題浮現」是同一件事的兩個面向，
                // 不是湊巧同時出現的兩段獨立動畫。
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

      {/* 中心貼紙：獨立圖層、不隨唱片旋轉，承載標題。落下瞬間（指針動畫結束的那一刻）
          才淡入放大，讓「標題出現」在視覺因果上跟著「指針落下」發生，而不是各自
          獨立的進場動畫。 */}
      <motion.div
        initial={skipSequence ? false : { opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={skipSequence ? { duration: 0.01 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.95 }}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '42%',
          height: '42%',
          borderRadius: '50%',
          background: 'var(--accent)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2px',
          boxShadow: '0 4px 16px -4px rgba(0, 0, 0, 0.5)',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'clamp(0.95rem, 4.2vw, 1.15rem)',
            color: 'var(--accent-ink)',
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
          }}
        >
          音樂猜歌
        </h1>
        {/* 唱片中軸孔——體積很小，純粹是這個隱喻裡「唱片」之所以成立的最後一塊
            拼圖，沒有它中心貼紙看起來只是一顆普通的金色圓點。 */}
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

      {/* 指針（tonearm）：從右上方的固定軸心擺入。停靠角度跟播放角度之間只差一個
          不大的弧度，模擬真實指針「抬起、移到唱片上方、放下」的運動路徑，不是
          誇張地從畫面外甩進來。 */}
      <motion.div
        aria-hidden="true"
        initial={skipSequence ? false : { rotate: -28 }}
        animate={{ rotate: 0 }}
        transition={skipSequence ? { duration: 0.01 } : { duration: 0.8, ease: [0.34, 1.1, 0.64, 1], delay: 0.15 }}
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
          {/* 軸心底座 */}
          <circle cx="88" cy="12" r="7" fill="var(--ink-dim)" opacity="0.5" />
          <circle cx="88" cy="12" r="3.2" fill="var(--bg-raised)" />
          {/* 搖臂本身，指向唱片邊緣 */}
          <line x1="88" y1="12" x2="22" y2="78" stroke="var(--ink-dim)" strokeWidth="2.5" strokeLinecap="round" />
          {/* 唱頭／唱針尖端 */}
          <circle cx="22" cy="78" r="4" fill="var(--accent)" />
        </svg>
      </motion.div>
    </div>
  );
}
