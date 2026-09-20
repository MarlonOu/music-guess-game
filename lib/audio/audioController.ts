export type AudioLoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * 較細緻的播放狀態，供 UI 顯示「載入中／等待播放／播放中／已暫停／播放完畢／失敗」等明確動畫用。
 * 與 AudioLoadState 並存（沿用舊介面，避免大幅改動既有呼叫端），新元件一律改訂閱這個狀態。
 * - idle：尚未播放過（或已被 stop() 重置，例如換題時）
 * - loading：play() 已呼叫，等待播放器真正回報「開始播放」
 * - playing：播放中
 * - paused：使用者主動暫停（pause()）
 * - finished：片段時長到，自動停止（非使用者操作），與「使用者主動暫停」在語意上分開，UI 可用不同文字/圖示呈現
 * - error：載入或播放失敗
 */
export type AudioPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error';

/**
 * 播放來源。優先序 'apple' → 'deezer' → 'youtube'——理由見 lib/audio/resolvePlaybackTarget.ts，
 * 核心是 Apple Music／Deezer 試聽都用同源 <audio> 元素播放，不像 YouTube IFrame 是跨網域的
 * 第三方播放器，不會有控制中心洩漏答案的問題；Deezer 是 Apple Music 目錄沒收錄時的第二層備援。
 */
export type AudioSource = 'apple' | 'deezer' | 'youtube';

// YouTube IFrame Player API 為第三方全域腳本注入的型別，官方未提供正式型別套件對應此版本，
// 故以最小必要介面自行宣告，避免引入未經審核的第三方型別定義。
interface YouTubePlayer {
  loadVideoById(config: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  destroy(): void;
}

interface YouTubeOnStateChangeEvent {
  data: number;
}
interface YouTubeOnErrorEvent {
  data: number;
}

interface YouTubePlayerConstructorOptions {
  height: string;
  width: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady: () => void;
    onError: (event: YouTubeOnErrorEvent) => void;
    onStateChange: (event: YouTubeOnStateChangeEvent) => void;
  };
}

declare global {
  interface Window {
    YT?: {
      Player: new (elementIdOrElement: string | HTMLElement, options: YouTubePlayerConstructorOptions) => YouTubePlayer;
      PlayerState: { PLAYING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<void> | null = null;

// YouTube IFrame API onError 事件的 data 欄位對照表，供除錯訊息使用
// 參考 https://developers.google.com/youtube/iframe_api_reference#onError
const YT_ERROR_MEANINGS: Record<number, string> = {
  2: '無效的 videoId 參數',
  5: 'HTML5 播放器錯誤',
  100: '找不到影片（可能已下架或設為不公開）',
  101: '影片擁有者關閉了外部網站的嵌入播放權限',
  150: '影片擁有者關閉了外部網站的嵌入播放權限',
};

const PLAY_TIMEOUT_MS = 10000;
const YT_READY_POLL_TIMEOUT_MS = 5000;
const YT_READY_POLL_INTERVAL_MS = 50;
// 供 unlock() 使用的極短公開影片 id（YouTube 上第一支公開影片，長期穩定存在），
// 純粹作為播放解鎖的技術性觸發用途，播放時間極短、音量歸零，不構成實質播放內容。
const UNLOCK_VIDEO_ID = 'jNQXAC9IVRw';
// 供 unlock() 解鎖 <audio> 元素使用的極短靜音音檔（純合成的靜音 WAV，不含任何受著作權保護的內容），
// 用來在使用者手勢當下觸發一次真正的 play()，讓瀏覽器記住「這個 <audio> 元素已獲得播放授權」。
const SILENT_AUDIO_DATA_URI = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAAA=';

/**
 * 注入 YouTube IFrame API 腳本並等待其就緒。
 * 全域 script 只注入一次（多個 AudioController 實例共用同一份 API 載入 promise）。
 */
function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };

    if (document.getElementById('youtube-iframe-api')) return;
    const script = document.createElement('script');
    script.id = 'youtube-iframe-api';
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });

  return apiLoadPromise;
}

/**
 * YouTube IFrame API 有個已知時序陷阱：onYouTubeIframeAPIReady 有時會在
 * window.YT 物件真正完全就緒「之前」就被觸發。改用短輪詢確認 window.YT.Player
 * 真的存在，而不是收到 callback 就直接假設可用。
 */
function waitForYT(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (window.YT?.Player) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - startedAt > YT_READY_POLL_TIMEOUT_MS) {
        clearInterval(interval);
        reject(new Error('等待 YouTube IFrame API 就緒逾時'));
      }
    }, YT_READY_POLL_INTERVAL_MS);
  });
}

export class AudioController {
  private player: YouTubePlayer | null = null;
  /** Apple Music／Deezer 試聽片段用的原生 <audio> 元素；跟 YT.Player 是兩條平行的播放路徑 */
  private audioEl: HTMLAudioElement | null = null;
  /** 目前這次播放實際用的是哪個來源，pause()／stop() 等方法需要知道要操作哪一邊 */
  private activeSource: AudioSource | null = null;
  private loadState: AudioLoadState = 'idle';
  private status: AudioPlaybackStatus = 'idle';
  private onStatusChange: ((status: AudioPlaybackStatus) => void) | undefined;
  private stopHandle: ReturnType<typeof setTimeout> | null = null;
  private readyPromise: Promise<void> | null = null;
  private disposed = false;
  private playing = false;
  private unlocked = false;
  /** 該片段自動停止的剩餘毫秒數；null 代表無上限（或尚未開始播放） */
  private remainingMs: number | null = null;
  /** 目前這段播放（play 或 resume）實際開始的時間戳，供 pause 時換算剩餘時間 */
  private segmentStartedAt: number | null = null;
  /** 最近一次嘗試播放的 videoId，僅供錯誤訊息 log 使用 */
  private lastVideoId: string | null = null;
  /** 目前這次 play() 呼叫等待「真正開始播放」或「出錯」的 pending callback */
  private pendingPlayResult: { resolve: () => void; reject: (err: Error) => void } | null = null;

  /**
   * containerElementId：頁面上已掛載的空 div id，YT.Player 會將其替換為 iframe。
   * 呼叫端負責提供此容器，尺寸需至少 200x200（YouTube IFrame API 官方最低規定），
   * 以「移到畫面外」而非「縮小尺寸」的方式隱藏，避免違反最小可視範圍規定導致播放失敗。
   */
  constructor(private readonly containerElementId: string) {}

  getLoadState(): AudioLoadState {
    return this.loadState;
  }

  getStatus(): AudioPlaybackStatus {
    return this.status;
  }

  /**
   * 訂閱播放狀態變化，供 UI 呈現載入中／播放中／已暫停／播放完畢／失敗等動畫用。
   * 傳入 undefined 取消訂閱。呼叫端元件卸載或換題重新掛載時記得取消，避免呼叫到已卸載元件的 setState。
   */
  setOnStatusChange(callback: ((status: AudioPlaybackStatus) => void) | undefined): void {
    this.onStatusChange = callback;
  }

  private setStatus(status: AudioPlaybackStatus): void {
    this.status = status;
    this.onStatusChange?.(status);
  }

  /**
   * 覆寫瀏覽器的媒體資訊（手機鎖定畫面／控制中心顯示的曲名／播放狀態）。
   *
   * 對 YouTube 來源：實際播放音樂的是一個跨網域的 YouTube iframe，我們的程式完全無法讀取或
   * 修改它內部的任何東西（跨網域安全限制），這裡的設定只是盡力而為的緩解措施，不保證一定蓋得掉
   * YouTube 自己回報的曲名（如果瀏覽器認定「實際播放媒體的那個 iframe 文件」才是媒體資訊來源，
   * 我們這邊的設定就蓋不掉，這是跨網域 iframe 的技術限制，前端沒有辦法完全繞過）。
   *
   * 對 Apple Music／Deezer 來源：播放用的是我們自己頁面裡的原生 <audio> 元素（同源，不是第三方
   * iframe），這裡的設定會真正生效、可靠地蓋掉曲名——這正是優先選用這兩個來源的核心理由。
   */
  private updateMediaSession(playbackState: 'playing' | 'paused' | 'none'): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: '音樂猜歌',
        artist: '播放中…',
        album: '',
      });
      navigator.mediaSession.playbackState = playbackState;
    } catch (err) {
      // 部分瀏覽器版本可能不支援特定屬性，安靜忽略即可，不影響遊戲本身的播放邏輯
      console.warn('[AudioController] 設定 Media Session 資訊失敗（不影響播放）：', err);
    }
  }

  getIsPlaying(): boolean {
    return this.playing;
  }

  /**
   * 背景預先建立 YouTube 播放器（載入 IFrame API script、建立空的 iframe），不播放任何內容，
   * 也不需要使用者手勢——單純建立空播放器本身不受自動播放政策限制。
   *
   * 目的：這是解決「手機第一首歌常常載入失敗，要多按幾次才行」的關鍵。第一次真正呼叫 play() 時，
   * 如果播放器都還沒建立，光是載入 IFrame API script＋建立播放器在行動網路上可能要 1~2 秒以上，
   * 等到真正呼叫 playVideo() 時，手機瀏覽器（尤其 iOS Safari）已經判定這次點擊的使用者手勢過期，
   * 於是直接擋下播放。呼叫端應在玩家進入遊戲畫面、但還沒點下第一次播放前就呼叫這個方法暖機，
   * 之後玩家實際點擊播放時，播放器已經就緒，playVideo() 幾乎瞬間完成，落在手勢有效期內。
   *
   * 只暖機 YouTube 這端：Apple Music／Deezer 用的原生 <audio> 元素建立是同步、瞬間完成的
   * （new Audio() 不需要等任何非同步腳本載入），不存在「暖機」這個問題，不用特別處理。
   *
   * 失敗時只記錄 log、不拋出例外、也不改變 loadState／status——暖機失敗不該讓玩家看到任何錯誤畫面，
   * 之後玩家實際點擊播放時會走原本的 play() 邏輯正常重試。
   */
  async preload(): Promise<void> {
    try {
      await this.ensurePlayer();
    } catch (err) {
      console.warn('[AudioController] preload() 暖機失敗，將於使用者實際播放時重試：', err);
    }
  }

  /**
   * 解鎖行動裝置的自動播放限制（比 preload() 更進一步）。
   *
   * preload() 只是背景建立播放器，本身不構成「使用者手勢觸發播放」，在手機嚴格的自動播放政策下
   * （尤其 iOS Safari）不足以讓之後「由計時器自動觸發」的 play() 真的出聲。
   * 這個方法要在真正的使用者互動（例如按鈕的 onClick／表單 onSubmit）裡、還沒有任何 await 之前
   * 的第一行呼叫，才能確保這次呼叫仍落在瀏覽器認定的「使用者手勢有效期」內。
   *
   * 同時解鎖 YouTube 與原生 <audio>（Apple Music／Deezer 共用）兩條播放路徑，因為呼叫當下
   * 還不知道等一下實際會播到哪個來源的歌，兩邊都先解鎖比較保險。
   *
   * YouTube 這端做法：實際載入一小段極短的公開影片並播放、幾乎立刻暫停（且靜音），讓瀏覽器把
   * 「這個播放器實例」標記為已獲得播放授權——之後同一個實例即使是被 setInterval 這類非使用者
   * 手勢的呼叫觸發播放，多數瀏覽器仍會允許（這是常見的「播放解鎖」技巧，Howler.js 等音訊函式庫
   * 也採用類似做法）。影片本身選用 YouTube 上第一支公開影片（jNQXAC9IVRw，長期穩定存在），
   * 純粹作為技術性的播放觸發用途，播放時間極短且音量歸零，使用者不會聽到。
   *
   * 原生 <audio> 這端做法：Apple Music／Deezer 共用同一個元素，一樣需要在使用者手勢當下
   * 播放過一次才能解鎖，
   * 用一小段純合成的靜音音檔（不含任何受著作權保護的內容）播放、立刻暫停即可，
   * 不像 YouTube 需要先等 IFrame API script 載入完成，這段幾乎是瞬間完成。
   *
   * 誠實聲明：瀏覽器的自動播放政策完全由各家廠商自行控制且可能隨版本調整，
   * 任何前端技巧都無法提供 100% 保證，這個方法只是目前能做到最可靠的緩解措施。
   */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    try {
      const audio = this.ensureAudioElement();
      audio.muted = true;
      audio.src = SILENT_AUDIO_DATA_URI;
      const appleUnlockPromise = audio
        .play()
        .then(() => audio.pause())
        .catch(() => {
          // Apple 這端解鎖失敗不影響 YouTube 那端繼續嘗試，兩邊各自獨立、互不阻擋
        });

      // 這裡不需要拿到 player 實例本身，全部透過 safeCallPlayer 呼叫（統一防呆，見該方法說明），
      // ensurePlayer() 純粹是確保播放器已經初始化完成。
      await this.ensurePlayer();
      // 先靜音再載入：有些手機瀏覽器的 YouTube IFrame 實作，loadVideoById() 載入新影片時
      // 會把先前設定的音量/靜音狀態重置回預設值，導致「載入前先 setVolume(0)」這一步
      // 實際上對接下來要播的這支影片沒有生效。載入完成後再呼叫一次 mute()，確保萬一真的
      // 被重置了也能補救回來——用 mute() 而不是只用 setVolume(0)，因為靜音狀態通常比
      // 音量數值更可靠，不容易被同樣的重置行為影響。
      this.safeCallPlayer('mute');
      this.safeCallPlayer('loadVideoById', { videoId: UNLOCK_VIDEO_ID, startSeconds: 0 });
      this.safeCallPlayer('mute');
      this.safeCallPlayer('playVideo');

      // 這是先前「加入房間後會聽到/看到 Me at the Zoo」這支解鎖用影片的成因：舊版在這裡
      // 固定等待 150ms 就直接呼叫 pauseVideo()，但手機（尤其行動網路）啟動 iframe 播放器、
      // 真正開始播放前的延遲變化很大，網路稍慢時 150ms 常常還等不到播放真的開始，
      // pauseVideo() 這時對「還沒真的開始播放的內容」沒有效果；等它真正開始播放時，
      // 已經沒有人會再暫停它了——如果使用者這時候還在準備室、比賽都還沒開始，
      // 就完全沒有後續的真正播放呼叫可以蓋過去，這支解鎖影片就會一路播下去被使用者聽到看到。
      // 修法：不用猜時間，改成真的等播放器回報「已經進入播放狀態」（複用 playYoutube() 判斷
      // 播放是否成功的同一套 pendingPlayResult／handleStateChange 機制）才呼叫暫停，
      // 並保留一個 4 秒的安全上限，避免萬一事件真的沒觸發（例如影片被封鎖）卡住整個解鎖流程。
      await Promise.race([
        new Promise<void>((resolve) => {
          this.pendingPlayResult = { resolve, reject: () => resolve() };
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 4000)),
      ]);
      this.pendingPlayResult = null;

      this.safeCallPlayer('pauseVideo');
      // 額外呼叫 stopVideo()：pauseVideo() 只是暫停在目前播放位置，理論上不該再自己動起來，
      // 但這裡是解鎖用的技術性播放，不是真的要保留播放進度給誰接續播放，直接完全停止、
      // 歸零播放狀態更保險，避免任何殘留狀態被意外恢復播放。
      this.safeCallPlayer('stopVideo');
      this.safeCallPlayer('unMute');
      this.safeCallPlayer('setVolume', 100);
      audio.muted = false;

      await appleUnlockPromise;
      this.unlocked = true;
    } catch (err) {
      console.warn('[AudioController] unlock() 失敗，將盡力於實際播放時重試：', err);
    }
  }

  private clearStopHandle(): void {
    if (this.stopHandle) {
      clearTimeout(this.stopHandle);
      this.stopHandle = null;
    }
  }

  private handleError(event: YouTubeOnErrorEvent): void {
    const meaning = YT_ERROR_MEANINGS[event.data] ?? '未知錯誤';
    console.error(
      `[AudioController] YouTube 播放器錯誤，videoId=${this.lastVideoId ?? '(尚未指定)'}，錯誤碼 ${event.data}：${meaning}`
    );
    this.playing = false;
    this.loadState = 'error';
    this.setStatus('error');
    if (this.pendingPlayResult) {
      this.pendingPlayResult.reject(new Error(`YouTube 影片載入失敗：${meaning}（錯誤碼 ${event.data}）`));
      this.pendingPlayResult = null;
    }
  }

  private handleStateChange(event: YouTubeOnStateChangeEvent): void {
    if (window.YT && event.data === window.YT.PlayerState.PLAYING && this.pendingPlayResult) {
      this.pendingPlayResult.resolve();
      this.pendingPlayResult = null;
    }
  }

  private async ensurePlayer(): Promise<YouTubePlayer> {
    if (this.player) return this.player;

    if (!this.readyPromise) {
      this.readyPromise = this.createPlayer().catch((err) => {
        // 失敗時清掉快取，讓下一次呼叫可以重新嘗試，
        // 而不是永久卡在同一個失敗結果（先前版本的問題）。
        this.readyPromise = null;
        throw err;
      });
    }

    await this.readyPromise;
    if (!this.player) throw new Error('YouTube Player 初始化失敗');
    return this.player;
  }

  /**
   * 安全呼叫 this.player 上的方法，不管什麼原因（YouTube IFrame API 腳本載入不完整、
   * 元件在播放器真正就緒前就被卸載、或任何未預期的狀態）都不讓例外往外拋出、
   * 導致整個頁面連環崩潰（曾發生過的真實事故：this.player 存在但缺少 pauseVideo
   * 方法，stop()／dispose() 疊代呼叫拋出例外，最終讓瀏覽器分頁直接當掉）。
   * 失敗只記錄 log，呼叫端的播放狀態（status／loadState）不受影響，
   * 之後玩家自己按播放按鈕時會走正常的 play() 邏輯重新嘗試。
   */
  private safeCallPlayer<K extends keyof YouTubePlayer>(method: K, ...args: Parameters<YouTubePlayer[K]>): void {
    const player = this.player;
    if (!player) return;
    const fn = player[method];
    if (typeof fn !== 'function') {
      console.warn(`[AudioController] this.player.${String(method)} 不是函式，略過這次呼叫`);
      return;
    }
    try {
      (fn as (...a: unknown[]) => unknown).apply(player, args);
    } catch (err) {
      console.warn(`[AudioController] 呼叫 this.player.${String(method)} 時發生例外，已攔截：`, err);
    }
  }

  /**
   * 建立（或找到既有的）純 DOM 容器元素，交給 YouTube IFrame API 使用。
   *
   * 關鍵：這個元素刻意用 document.createElement 手動建立、appendChild 掛到 <body>，
   * 完全不透過 React 的 JSX 渲染。原因是一個已知的 React／YouTube IFrame API 衝突：
   * new YT.Player(el, ...) 會直接把傳入的元素整個換成一個 iframe（在 React 的虛擬 DOM
   * 完全不知情的狀況下操作真實 DOM）。如果這個元素原本是「由 React JSX 渲染出來的節點」，
   * 之後只要 React 重新渲染到那附近（例如頁面切換、父層元件重新渲染），React 會發現真實
   * DOM 跟它記憶中的不一致，直接丟出 insertBefore／removeChild 這類例外，導致整個分頁崩潰
   * （實際發生過的事故：搬到根 layout 讓這個元素跨頁面存活後，反而更容易觸發這個衝突）。
   * 手動建立、掛在 <body> 底下且從頭到尾不讓 React 碰，就能完全避開這個衝突，
   * 不管 YouTube API 之後對這個節點做什麼，React 都不會嘗試去管它。
   */
  private ensureContainerElement(): HTMLElement {
    let el = document.getElementById(this.containerElementId);
    if (!el) {
      el = document.createElement('div');
      el.id = this.containerElementId;
      // 移到畫面外而非縮小尺寸或 display:none——YouTube IFrame API 要求至少 200x200
      // 的可視尺寸才能正常運作，尺寸太小或不可視會導致播放失敗。
      el.style.position = 'fixed';
      el.style.top = '-9999px';
      el.style.left = '-9999px';
      el.style.width = '200px';
      el.style.height = '200px';
      document.body.appendChild(el);
    }
    return el;
  }

  /**
   * 建立（或找到既有的）原生 <audio> 元素，供 Apple Music／Deezer 試聽片段播放使用
   * （兩者都是直接可播放的音檔網址，走同一條播放路徑，只是網址來源不同）。
   * 跟 YT.Player 不同，這個元素完全在我們自己的掌控中（同源），不用擔心跟 React 的虛擬 DOM
   * 衝突（不透過 React 渲染，也不會被 YouTube API 那種「整個換成 iframe」的方式操作），
   * 建立本身也是同步、瞬間完成，不需要暖機。
   */
  private ensureAudioElement(): HTMLAudioElement {
    if (!this.audioEl) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.addEventListener('ended', () => {
        if (this.activeSource !== 'youtube' && this.playing) this.finishPlayback();
      });
      audio.addEventListener('error', () => {
        if (this.activeSource === 'youtube' || this.activeSource === null) return;
        console.error(`[AudioController] <audio> 播放 ${this.activeSource} 試聽失敗，src=`, audio.src);
        this.loadState = 'error';
        this.playing = false;
        this.setStatus('error');
        if (this.pendingPlayResult) {
          this.pendingPlayResult.reject(new Error('試聽片段載入失敗'));
          this.pendingPlayResult = null;
        }
      });
      this.audioEl = audio;
    }
    return this.audioEl;
  }

  private async createPlayer(): Promise<void> {
    await loadYouTubeIframeApi();
    await waitForYT();

    if (this.disposed || !window.YT) {
      throw new Error('YouTube IFrame API 不可用');
    }

    const container = this.ensureContainerElement();

    await new Promise<void>((resolve, reject) => {
      try {
        this.player = new window.YT!.Player(container, {
          height: '200',
          width: '200',
          playerVars: { controls: 0, disablekb: 1, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: () => resolve(),
            onError: (event) => {
              this.handleError(event);
              reject(new Error('YouTube Player 初始化失敗'));
            },
            onStateChange: (event) => this.handleStateChange(event),
          },
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error('YouTube Player 初始化失敗'));
      }
    });
  }

  /**
   * 設下（或重新設下）自動停止計時器，計時長度取自 remainingMs。
   * remainingMs 為 null 時不設自動停止（片段無時長上限）。
   * 時間到呼叫 finishPlayback()（而非 pause()），讓 UI 能區分「時長到自動停止」與「使用者主動暫停」。
   */
  private armStopTimer(): void {
    this.clearStopHandle();
    if (this.remainingMs === null) return;
    this.segmentStartedAt = Date.now();
    this.stopHandle = setTimeout(() => {
      this.finishPlayback();
    }, this.remainingMs);
  }

  /** 片段時長到，系統自動停止播放（非使用者操作），狀態設為 'finished' 供 UI 顯示「播放完畢」 */
  private finishPlayback(): void {
    this.clearStopHandle();
    this.pauseActiveSource();
    this.playing = false;
    this.remainingMs = null;
    this.segmentStartedAt = null;
    this.setStatus('finished');
    this.updateMediaSession('none');
  }

  /** 依 activeSource 暫停對應的播放器，pause()／stop()／finishPlayback() 共用 */
  private pauseActiveSource(): void {
    if (this.activeSource === 'youtube') {
      this.safeCallPlayer('pauseVideo');
    } else {
      this.audioEl?.pause();
    }
  }

  /**
   * 播放指定來源的音訊片段。
   * - source='youtube'：idOrUrl 是 YouTube 影片 id，startSec/durationSec 是相對於完整影片的秒數。
   * - source='apple'／'deezer'：idOrUrl 是官方試聽片段的直接可播放網址
   *   （appleMusicPreviewUrl／deezerPreviewUrl），兩者走同一條原生 <audio> 播放路徑。
   *   官方試聽都是固定長度（通常 30 秒上下）的片段，不像 YouTube 完整影片可以任意指定
   *   開始秒數；呼叫端（見 lib/audio/resolvePlaybackTarget.ts）已經把這個限制考慮進去，
   *   這裡單純負責把收到的 startSec/durationSec 套用在這個 <audio> 元素上。
   *
   * durationSec 省略時不設自動停止上限，播放至片段自然結束（'ended' 事件）或使用者自行暫停為止。
   * 呼叫端須在使用者按下「播放」時手動呼叫，不再自動觸發。
   *
   * 邊界條件：來源無效、播放器初始化失敗、或逾時未開始播放時，
   * loadState 設為 'error'，呼叫端需檢查此狀態並顯示對應 UI（不拋出例外中斷遊戲流程）。
   */
  async play(source: AudioSource, idOrUrl: string, startSec: number, durationSec?: number): Promise<void> {
    this.clearStopHandle();
    this.loadState = 'loading';
    this.setStatus('loading');
    this.lastVideoId = idOrUrl;
    this.pendingPlayResult = null;

    // 換來源播放時，把另一邊可能還在播的東西停掉，避免兩邊同時出聲
    if (this.activeSource && this.activeSource !== source) this.pauseActiveSource();
    this.activeSource = source;

    if (source === 'youtube') {
      await this.playYoutube(idOrUrl, startSec, durationSec);
      return;
    }
    await this.playNativeAudio(idOrUrl, startSec, durationSec);
  }

  /**
   * 真正等待播放器回報「已開始播放」（onStateChange -> PLAYING）或「出錯」（onError）
   * 才 resolve／視為失敗，不像先前版本呼叫完 API 就假設成功 —— 否則影片本身的錯誤
   * （例如嵌入權限關閉）會在呼叫已經回傳「成功」之後才非同步發生，被靜默吃掉。
   */
  private async playYoutube(videoId: string, startSec: number, durationSec?: number): Promise<void> {
    try {
      const player = await this.ensurePlayer();

      await new Promise<void>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this.pendingPlayResult = null;
          reject(new Error('播放逾時：YouTube 播放器未在時限內回報開始播放'));
        }, PLAY_TIMEOUT_MS);

        this.pendingPlayResult = {
          resolve: () => {
            clearTimeout(timeoutHandle);
            resolve();
          },
          reject: (err) => {
            clearTimeout(timeoutHandle);
            reject(err);
          },
        };

        player.loadVideoById({ videoId, startSeconds: startSec });
        // 部分瀏覽器的自動播放政策會讓 YT.Player 以靜音狀態初始化，
        // 即使播放本身是由使用者點擊觸發（合法的 user gesture）也一樣；
        // 顯式呼叫 unMute + 設定音量，確保真的聽得到聲音。
        player.unMute();
        player.setVolume(100);
        player.playVideo();
      });

      this.loadState = 'ready';
      this.playing = true;
      this.remainingMs = durationSec !== undefined ? durationSec * 1000 : null;
      this.armStopTimer();
      this.setStatus('playing');
      this.updateMediaSession('playing');
    } catch (err) {
      console.error('[AudioController] playYoutube() 失敗：', err);
      this.loadState = 'error';
      this.playing = false;
      this.setStatus('error');
    }
  }

  /**
   * 播放 Apple Music／Deezer 試聽片段。相較 YouTube 路徑單純很多：不用等任何非同步腳本載入、
   * 不用透過 postMessage 跟 iframe 溝通，直接操作原生 <audio> 元素的標準 API 即可。
   * 兩個來源的試聽網址性質完全一樣（都是直接可播放的音檔網址），共用同一套邏輯。
   */
  private async playNativeAudio(previewUrl: string, startSec: number, durationSec?: number): Promise<void> {
    try {
      const audio = this.ensureAudioElement();
      if (audio.src !== previewUrl) {
        audio.src = previewUrl;
      }
      audio.muted = false;
      audio.volume = 1;
      // 部分瀏覽器（尤其行動裝置）要等 metadata 載入完成才能設定 currentTime，
      // 設太早會被靜默忽略；readyState >= 1（HAVE_METADATA）代表已經知道片段長度，可以安全設定。
      if (audio.readyState < 1) {
        await new Promise<void>((resolve) => {
          const onLoaded = () => {
            audio.removeEventListener('loadedmetadata', onLoaded);
            resolve();
          };
          audio.addEventListener('loadedmetadata', onLoaded);
          // 保險逾時：萬一 loadedmetadata 因為某些瀏覽器怪癖沒觸發，別讓整個 play() 卡死
          setTimeout(resolve, 2000);
        });
      }
      audio.currentTime = startSec;
      await audio.play();

      this.loadState = 'ready';
      this.playing = true;
      this.remainingMs = durationSec !== undefined ? durationSec * 1000 : null;
      this.armStopTimer();
      this.setStatus('playing');
      this.updateMediaSession('playing');
    } catch (err) {
      console.error('[AudioController] playNativeAudio() 失敗：', err);
      this.loadState = 'error';
      this.playing = false;
      this.setStatus('error');
    }
  }

  /** 暫停播放，並記錄該片段剩餘的自動停止時間，供 resume() 接續計算 */
  pause(): void {
    if (!this.playing) return;
    if (this.remainingMs !== null && this.segmentStartedAt !== null) {
      const elapsed = Date.now() - this.segmentStartedAt;
      this.remainingMs = Math.max(0, this.remainingMs - elapsed);
    }
    this.clearStopHandle();
    this.pauseActiveSource();
    this.playing = false;
    this.setStatus('paused');
    this.updateMediaSession('paused');
  }

  /**
   * 從暫停處繼續播放，沿用 pause() 當下記錄的剩餘自動停止時間。
   * 只有在上一次 play() 確實成功（loadState === 'ready'）時才有意義；
   * 呼叫端應自行判斷 getLoadState() 是否為 'ready'，錯誤狀態下應改呼叫 play() 重試。
   */
  resume(): void {
    if (this.playing || this.loadState !== 'ready') return;
    if (this.activeSource === 'youtube') {
      if (!this.player) return;
      this.safeCallPlayer('playVideo');
    } else {
      if (!this.audioEl) return;
      this.audioEl.play().catch((err) => {
        console.warn('[AudioController] resume() 的 <audio>.play() 失敗：', err);
      });
    }
    this.playing = true;
    this.armStopTimer();
    this.setStatus('playing');
    this.updateMediaSession('playing');
  }

  /** 完全停止並清除進度（下次需重新呼叫 play() 從頭開始） */
  stop(): void {
    this.clearStopHandle();
    this.pauseActiveSource();
    this.playing = false;
    this.remainingMs = null;
    this.segmentStartedAt = null;
    this.setStatus('idle');
    this.updateMediaSession('none');
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.safeCallPlayer('destroy');
    this.player = null;
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
      this.audioEl = null;
    }
    // 清掉我們自己建立、掛在 <body> 底下的容器元素，避免每次 dispose 都留下一個孤兒節點
    // （單機模式每次進遊戲頁面都會建立一個新的 AudioController，長時間下來會累積 DOM 節點）。
    // 注意：線上模式共用的全域實例（getGlobalAudioController()）不會呼叫 dispose()，
    // 所以這裡不用擔心會把還在使用中的全域容器誤刪。
    document.getElementById(this.containerElementId)?.remove();
  }
}
