export type AudioLoadState = 'idle' | 'loading' | 'ready' | 'error';

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
      Player: new (elementId: string, options: YouTubePlayerConstructorOptions) => YouTubePlayer;
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
  private stopHandle: ReturnType<typeof setTimeout> | null = null;
  private readyPromise: Promise<void> | null = null;
  private disposed = false;
  private playing = false;
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

  getIsPlaying(): boolean {
    return this.playing;
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

  private async createPlayer(): Promise<void> {
    await loadYouTubeIframeApi();
    await waitForYT();

    if (this.disposed || !window.YT) {
      throw new Error('YouTube IFrame API 不可用');
    }

    await new Promise<void>((resolve, reject) => {
      try {
        this.player = new window.YT!.Player(this.containerElementId, {
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
   */
  private armStopTimer(): void {
    this.clearStopHandle();
    if (this.remainingMs === null) return;
    this.segmentStartedAt = Date.now();
    this.stopHandle = setTimeout(() => {
      this.pause();
    }, this.remainingMs);
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
    } catch (err) {
      console.error('[AudioController] play() 失敗：', err);
      this.loadState = 'error';
      this.playing = false;
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
    this.player?.pauseVideo();
    this.playing = false;
  }

  /**
   * 從暫停處繼續播放，沿用 pause() 當下記錄的剩餘自動停止時間。
   * 只有在上一次 play() 確實成功（loadState === 'ready'）時才有意義；
   * 呼叫端應自行判斷 getLoadState() 是否為 'ready'，錯誤狀態下應改呼叫 play() 重試。
   */
  resume(): void {
    if (this.playing || !this.player || this.loadState !== 'ready') return;
    this.player.playVideo();
    this.playing = true;
    this.armStopTimer();
  }

  /** 完全停止並清除進度（下次需重新呼叫 play() 從頭開始） */
  stop(): void {
    this.clearStopHandle();
    this.player?.pauseVideo();
    this.playing = false;
    this.remainingMs = null;
    this.segmentStartedAt = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.player?.destroy();
    this.player = null;
  }
}
