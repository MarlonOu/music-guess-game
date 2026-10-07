'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { Turntable } from '../components/home/Turntable';

interface ModeDef {
  href: string;
  track: string;
  title: string;
  desc: string;
  tag: string;
  /** 唱片中心貼紙色——借用黑膠唱片不同廠牌中心貼紙顏色不同的慣例，
   *  讓三個模式一眼就能分辨，不需要額外的圖示或裝飾。 */
  color: string;
}

const MODES: ModeDef[] = [
  { href: '/match-setup', track: 'A1', title: '單機模式', desc: '一個人，自己出題自己猜', tag: '獨奏', color: 'var(--accent)' },
  { href: '/online', track: 'A2', title: '線上模式', desc: '開房間，跟朋友一起搶答', tag: '多人', color: 'var(--mode-online)' },
  { href: '/speedrun', track: 'A3', title: '速通挑戰', desc: '碼表計時，衝上排行榜', tag: '限時', color: 'var(--mode-speedrun)' },
  { href: '/streak', track: 'A4', title: '無限連勝', desc: '從 1 秒聽到 20 秒，連續猜中不斷線', tag: '無限', color: 'var(--mode-streak)' },
];

function TrackRow({
  mode,
  index,
  onActive,
}: {
  mode: ModeDef;
  index: number;
  onActive: (index: number | null) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 1.15 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link
        href={mode.href}
        className="track-row"
        onPointerEnter={() => onActive(index)}
        onPointerLeave={() => onActive(null)}
        onFocus={() => onActive(index)}
        onBlur={() => onActive(null)}
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'center',
          gap: '18px',
          padding: '18px 4px',
          minHeight: '72px',
          borderBottom: '1px solid var(--groove)',
          // CSS 自訂屬性傳給 globals.css 裡的 .track-row，hover 時的左側色條、
          // 數字變色都讀這個變數——三行共用同一份樣式規則，顏色差異完全由
          // 資料驅動，不需要為每個模式各寫一份幾乎一樣的 CSS。
          ['--row-accent' as string]: mode.color,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            color: 'var(--ink-dim)',
            width: '28px',
            transition: 'color 0.2s ease',
          }}
          className="track-row-number"
        >
          {mode.track}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.05rem' }}>
            {mode.title}
          </span>
          <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>{mode.desc}</span>
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            color: mode.color,
            border: `1px solid ${mode.color}`,
            borderRadius: '999px',
            padding: '4px 11px',
            whiteSpace: 'nowrap',
          }}
        >
          {mode.tag}
        </span>
      </Link>
    </motion.div>
  );
}

export default function Home() {
  const prefersReducedMotion = useReducedMotion();
  const [activeTrack, setActiveTrack] = useState<number | null>(null);

  return (
    <main className="home">
      <div className="home-inner">
        <div className="home-hero">
          <Turntable activeTrack={activeTrack} size="var(--disc)" />
        </div>

        <div className="home-side">
          <motion.p
            className="home-tagline"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.5, delay: 1.1 }}
          >
            聽見旋律，喊出歌名
          </motion.p>

          <nav className="home-list" aria-label="選擇遊戲模式">
            {MODES.map((mode, i) => (
              <TrackRow key={mode.href} mode={mode} index={i} onActive={setActiveTrack} />
            ))}
          </nav>

          <motion.div
            style={{ display: 'flex', flexDirection: 'column' }}
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.5, delay: 1.5 }}
          >
            <Link href="/admin" prefetch={false} className="home-admin">
              資料庫管理
            </Link>
          </motion.div>

          <motion.footer
            className="home-legal"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.5, delay: 1.7 }}
          >
            <p className="home-legal-line">
              歌曲、封面與商標之著作權屬原權利人所有。本站不儲存、不提供下載任何音檔。
            </p>
            <details className="home-legal-more">
              <summary>著作權與使用說明</summary>
              <ul>
                <li>
                  <b>音源</b>
                  <span>
                    試聽片段由 Apple Music、Deezer 提供，部分歌曲透過 YouTube 官方嵌入播放器播放。本站只連結並播放這些平台公開提供的內容，不轉載、不重製、不散布音檔。
                  </span>
                </li>
                <li>
                  <b>著作權</b>
                  <span>
                    歌曲、歌詞、專輯封面與相關商標，其著作權及相關權利皆屬原創作者、詞曲著作權人、唱片公司與各平台所有。本站與 Apple、Deezer、YouTube 及任何歌手、唱片公司皆無隸屬或合作關係。
                  </span>
                </li>
                <li>
                  <b>用途</b>
                  <span>
                    本站為個人學習與娛樂性質的非營利專案，僅供合理使用範圍內的猜歌遊戲。若您是權利人並認為有不當使用，請聯絡站長，確認後會盡速移除相關內容。
                  </span>
                </li>
                <li>
                  <b>個人資料</b>
                  <span>
                    不需註冊。線上房間與速通排行榜僅保存您自訂的暱稱與成績；最佳連勝等紀錄只儲存在您的裝置上。
                  </span>
                </li>
              </ul>
            </details>
          </motion.footer>
        </div>
      </div>
    </main>
  );
}
