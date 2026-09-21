import Link from 'next/link';

export default function Home() {
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div className="home-vinyl" aria-hidden="true" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.3rem', textAlign: 'center' }}>音樂猜歌</h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>聽一段音樂，猜出是哪一首</p>
      </div>

      <nav className="home-tracklist" aria-label="遊戲模式">
        <Link href="/match-setup" className="home-track">
          <span className="home-track-num">A1</span>
          <span className="home-track-body">
            <span className="home-track-title">單機模式</span>
            <span className="home-track-desc">一個人，自己出題自己猜</span>
          </span>
          <span className="home-track-eq" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </Link>

        <Link href="/online" className="home-track">
          <span className="home-track-num">A2</span>
          <span className="home-track-body">
            <span className="home-track-title">線上模式</span>
            <span className="home-track-desc">開房間，跟朋友一起搶答</span>
          </span>
          <span className="home-track-eq" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </Link>

        <Link href="/speedrun" className="home-track home-track--accent">
          <span className="home-track-num">A3</span>
          <span className="home-track-body">
            <span className="home-track-title">速通挑戰</span>
            <span className="home-track-desc">碼表計時，衝上排行榜</span>
            <span className="home-track-tag">
              <span className="home-track-tag-dot" aria-hidden="true" />
              45 RPM · 限時競速
            </span>
          </span>
          <span className="home-track-eq" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </Link>
      </nav>

      <Link href="/admin" prefetch={false} className="home-liner-notes">
        資料庫管理（歌手／歌曲）
      </Link>
    </main>
  );
}
