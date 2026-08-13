import { AudioController } from './audioController';

// 固定 id，對應 app/layout.tsx 裡常駐的隱藏容器 div。
// 這個容器活在根 layout，不會隨頁面切換（/online → /online/room/[joinCode]）被卸載重建，
// 這樣「加入房間」當下用使用者手勢解鎖的那個播放器實例，才能在進到房間、遊戲正式開始時繼續沿用。
export const GLOBAL_YT_PLAYER_CONTAINER_ID = 'global-yt-player-container';

let instance: AudioController | null = null;

/**
 * 取得線上模式共用的全域 AudioController 單例。
 *
 * 只能在瀏覽器環境呼叫（元件內、事件處理常式內），不要在模組頂層或伺服器端呼叫。
 * 整個分頁存續期間只會建立一個實例，供「加入房間／建立房間」（做播放解鎖）與
 * 房間內的 PlayingView（做實際播放）共用，讓解鎖動作真正生效於之後拿來播歌的同一個播放器。
 */
export function getGlobalAudioController(): AudioController {
  if (typeof window === 'undefined') {
    throw new Error('getGlobalAudioController 只能在瀏覽器環境呼叫');
  }
  if (!instance) {
    instance = new AudioController(GLOBAL_YT_PLAYER_CONTAINER_ID);
  }
  return instance;
}
