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

// YouTube IFrame Player API 為第三方全域腳本注入的型別，官方未提供正式型別套件對應此版本，
// 故以最小必要介面自行宣告，避免引入未經審核的第三方型別定義。
interface YouTubePlayer {
  loadVideoById(config: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
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
   * 背景：實際播放音樂的是一個跨網域的 YouTube iframe（youtube.com 自己內嵌的播放器），
   * 我們的程式完全無法讀取或修改它內部的任何東西（跨網域安全限制），包括它可能自己回報給
   * 作業系統的曲名資訊。這裡能做的，只是在「我們自己的頁面」設定一個通用、不含歌名的媒體
   * 資訊（Media Session API），多數瀏覽器狀況下會優先採用這個，蓋掉可能洩漏答案的曲名顯示。
   *
   * 誠實聲明：這是盡力而為的緩解措施，不保證每支手機、每個瀏覽器版本都 100%有效——
   * 如果作業系統認定「實際播放媒體的那個 iframe 文件」才是媒體資訊的來源，我們這邊的設定
   * 就蓋不掉，這是跨網域 iframe 的技術限制，前端沒有辦法完全繞過。
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
   * 做法：實際載入一小段極短的公開影片並播放、幾乎立刻暫停（且靜音），讓瀏覽器把「這個播放器
   * 實例」標記為已獲得播放授權——之後同一個實例即使是被 setInterval 這類非使用者手勢的呼叫
   * 觸發播放，多數瀏覽器仍會允許（這是常見的「播放解鎖」技巧，Howler.js 等音訊函式庫也採用
   * 類似做法）。影片本身選用 YouTube 上第一支公開影片（jNQXAC9IVRw，YouTube 官方historic
   * 影片，長期穩定存在），純粹作為技術性的播放觸發用途，播放時間極短且音量歸零，使用者不會聽到。
   *
   * 誠實聲明：瀏覽器的自動播放政策完全由各家廠商自行控制且可能隨版本調整，
   * 任何前端技巧都無法提供 100% 保證，這個方法只是目前能做到最可靠的緩解措施。
   */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    try {
      await this.ensurePlayer();
      this.safeCallPlayer('setVolume', 0);
      this.safeCallPlayer('loadVideoById', { videoId: UNLOCK_VIDEO_ID, startSeconds: 0 });
      this.safeCallPlayer('playVideo');
      await new Promise((resolve) => setTimeout(resolve, 150));
      this.safeCallPlayer('pauseVideo');
      this.safeCallPlayer('setVolume', 100);
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
    this.safeCallPlayer('pauseVideo');
    this.playing = false;
    this.remainingMs = null;
    this.segmentStartedAt = null;
    this.setStatus('finished');
    this.updateMediaSession('none');
  }

  /**
   * 從頭載入並播放指定 YouTube 影片（videoId）中 startSec 到 startSec + durationSec 的片段。
   * durationSec 省略時不設自動停止上限，播放至使用者自行暫停為止。
   * 呼叫端須在使用者按下「播放」時手動呼叫，不再自動觸發。
   *
   * 真正等待播放器回報「已開始播放」（onStateChange -> PLAYING）或「出錯」（onError）
   * 才 resolve／視為失敗，不像先前版本呼叫完 API 就假設成功 —— 否則影片本身的錯誤
   * （例如嵌入權限關閉）會在呼叫已經回傳「成功」之後才非同步發生，被靜默吃掉。
   *
   * 邊界條件：videoId 無效、IFrame API 載入失敗、或逾時未開始播放時，
   * loadState 設為 'error'，呼叫端需檢查此狀態並顯示對應 UI（不拋出例外中斷遊戲流程）。
   */
  async play(videoId: string, startSec: number, durationSec?: number): Promise<void> {
    this.clearStopHandle();
    this.loadState = 'loading';
    this.setStatus('loading');
    this.lastVideoId = videoId;
    this.pendingPlayResult = null;

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
      console.error('[AudioController] play() 失敗：', err);
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
    this.safeCallPlayer('pauseVideo');
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
    if (this.playing || !this.player || this.loadState !== 'ready') return;
    this.safeCallPlayer('playVideo');
    this.playing = true;
    this.armStopTimer();
    this.setStatus('playing');
    this.updateMediaSession('playing');
  }

  /** 完全停止並清除進度（下次需重新呼叫 play() 從頭開始） */
  stop(): void {
    this.clearStopHandle();
    this.safeCallPlayer('pauseVideo');
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
    // 清掉我們自己建立、掛在 <body> 底下的容器元素，避免每次 dispose 都留下一個孤兒節點
    // （單機模式每次進遊戲頁面都會建立一個新的 AudioController，長時間下來會累積 DOM 節點）。
    // 注意：線上模式共用的全域實例（getGlobalAudioController()）不會呼叫 dispose()，
    // 所以這裡不用擔心會把還在使用中的全域容器誤刪。
    document.getElementById(this.containerElementId)?.remove();
  }
}
