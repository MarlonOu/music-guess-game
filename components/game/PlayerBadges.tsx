'use client';

/**
 * 計分畫面共用的兩個小元件——單機模式（components/game/GamePage.tsx）跟線上模式
 * （app/online/room/[joinCode]/page.tsx）各自都有一份「排名列表」要顯示，原本
 * 兩邊各自寫了幾乎一模一樣的程式碼（emoji 獎牌、姓名直接裸露顯示），容易出現
 * 「同一個問題在其中一邊修好了、另一邊忘記一起改」的情況——抽成共用元件後，
 * 兩邊永遠是同一份邏輯，不會再出現視覺不一致或其中一邊漏修的狀況。
 */

/**
 * 名次徽章：用實心圓圈＋名次數字，不用 🥇🥈🥉 emoji——emoji 獎牌在不同作業系統、
 * 不同瀏覽器字體裡粗細、顏色、甚至造型都不一樣，跟整站自己畫的線條圖示放在一起
 * 會顯得突兀。第一名用金色實心圈＋深色數字（視覺權重最高），其餘名次用描邊圈，
 * 名次間的視覺落差刻意拉開，呼應頒獎台「金牌最顯眼、其餘陪襯」的直覺。
 */
export function RankBadge({ rank }: { rank: number }) {
  const isFirst = rank === 1;
  return (
    <span
      style={{
        flexShrink: 0,
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: '0.95rem',
        background: isFirst ? 'var(--accent)' : 'transparent',
        color: isFirst ? 'var(--accent-ink)' : 'var(--ink-dim)',
        border: isFirst ? 'none' : '1.5px solid var(--groove)',
      }}
    >
      {rank}
    </span>
  );
}

/** 給玩家身分色點用的固定色盤——刻意跟 --accent／--success／--error 這幾個已經有
 *  特定語意的顏色（分數本身、線上/速通模式識別）區隔開，避免玩家色點跟別處的顏色
 *  語意互相干擾。六個顏色彼此飽和度/明度相近，排在一起不會有誰特別搶眼的問題。 */
const PLAYER_DOT_PALETTE = ['#6B9BD1', '#B98DD6', '#6FBF8E', '#E89659', '#D685A8', '#7FC5C9'];

function playerDotColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PLAYER_DOT_PALETTE[hash % PLAYER_DOT_PALETTE.length];
}

/**
 * 玩家識別標籤：姓名前面加一個純色點，不放任何文字。
 *
 * 色點裡原本放姓名的第一個字，但玩家測試時很常直接把姓名輸入成「1」「2」「3」這種
 * 單一數字，色點裡的字會跟旁邊完整姓名的文字一模一樣，畫面上變成「1 1」這種看起來
 * 像打字重複的結果。色點本身的用途只是給身分一個獨立的視覺容器，不需要、也不該
 * 重複姓名的內容——改成純色、不放文字，顏色依玩家 id 算出來（同一位玩家在整場
 * 遊戲、不管在哪個畫面，色點顏色都會維持一致，方便玩家用顏色追蹤「這個是我」）。
 */
export function PlayerIdentity({ id, name }: { id: string; name: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: playerDotColor(id),
        }}
      />
      <span style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
    </span>
  );
}
