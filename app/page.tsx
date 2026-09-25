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

/** 三個圖示共用的外框圓圈——同樣的半徑、線寬，確保三個圖示是「同一組」的視覺重量，
 *  差異只在圓圈裡面的符號。這是先前版本被指出「不太合諧」的根因：舊版三個圖示的外框
 *  大小、線條粗細、甚至有沒有超出圓圈（碼表的錶冠）都不一致，重新設計時統一收斂成
 *  這一個共用元件，圓圈本身固定不動、只有內容物animate，看起來才會像一套圖示。 */
function IconRing() {
  return <circle cx="20" cy="20" r="17" stroke="var(--accent)" strokeWidth="1.5" fill="none" />;
}

/** 單機模式：播放鍵，靜止畫面就看得懂，脈動的是三角形本身而不是外框圓圈。
 *  origin 用 Framer Motion 自己的正規化座標（originX/originY，0~1 相對於這個元素自己的
 *  幾何邊界），不用原生 CSS 的 transformOrigin 字串——SVG 元素套用 CSS transform-origin 時，
 *  不同瀏覽器對「該用元素自己的邊界框（fill-box）還是整個 SVG 座標系（view-box）當基準」
 *  預設行為不一致，同一組數字換一個瀏覽器／裝置實際軸心點就不一樣，這是先前
 *  「碼表旋轉軸心跑掉、甚至有些裝置看起來像沒在動畫」的根本原因。Framer Motion 自己的
 *  origin 系統是它自己算出實際偏移量再套用，不依賴瀏覽器對這個 CSS 細節的解讀，才不會有
 *  跨瀏覽器不一致的問題。這個三角形路徑的幾何邊界框中心不是正好在 (20,20)，這裡用算過的
 *  分數（相對於路徑自己邊界框的比例）讓呼吸縮放的視覺中心對齊圖示的正中央。 */
function SoloIcon({ animate }: { animate: boolean }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <IconRing />
      <motion.path
        d="M16.5 13.5L27 20L16.5 26.5V13.5Z"
        fill="var(--accent)"
        style={{ originX: 0.333, originY: 0.5 }}
        animate={animate ? { scale: [1, 1.12, 1] } : undefined}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
    </svg>
  );
}

/** 線上模式：Wifi 訊號圖示（點+兩道弧線），靜止畫面本身就是大家熟悉的「訊號／連線」符號，
 *  不需要靠動畫才看得懂是什麼意思；動畫只是讓兩道弧線依序亮起，像訊號正在發送。 */
function OnlineIcon({ animate }: { animate: boolean }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <IconRing />
      <circle cx="20" cy="25.5" r="1.8" fill="var(--accent)" />
      <motion.path
        d="M14.5 21.5a8 8 0 0 1 11 0"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        animate={animate ? { opacity: [0.35, 1, 0.35] } : undefined}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.path
        d="M10.5 17.5a14 14 0 0 1 19 0"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        animate={animate ? { opacity: [0.35, 1, 0.35] } : undefined}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
      />
    </svg>
  );
}

/** 速通挑戰：碼表，12 點鐘方向一個小刻度暗示錶面，秒針從中心繞圈——刻意不讓任何線條
 *  超出外框圓圈（舊版的錶冠會突出去，是造成三個圖示輪廓對不齊的主因之一）。
 *  秒針的旋轉軸心用巢狀 <g transform="translate(20,20)"> 把座標系原點先平移到鐘面中心，
 *  秒針本身在這個已經平移過的座標系裡從 (0,0) 畫到 (0,-11)，旋轉軸心天生就是 (0,0)
 *  （也就是鐘面中心），不依賴 CSS transform-origin 在 SVG 元素上的跨瀏覽器不一致行為
 *  （原因見 SoloIcon 上方的說明，這裡是同一個問題但影響更明顯——縮放軸心偏一點只是
 *  視覺中心稍微不對稱，旋轉軸心偏掉的話指針會整個掃到圖示範圍外面，看起來完全不對，
 *  甚至在某些瀏覽器上會因為掃出範圍太離譜而看起來像「沒有動畫」）。 */
function SpeedrunIcon({ animate }: { animate: boolean }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <IconRing />
      <circle cx="20" cy="5.5" r="1.2" fill="var(--accent)" />
      <g transform="translate(20, 20)">
        <motion.line
          x1="0"
          y1="0"
          x2="0"
          y2="-11"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          style={{ originX: 0.5, originY: 1 }}
          animate={animate ? { rotate: 360 } : undefined}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}
        />
      </g>
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
