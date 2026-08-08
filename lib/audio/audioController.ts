export type AudioLoadState = 'idle' | 'loading' | 'ready' | 'error';

export class AudioController {
  private audio: HTMLAudioElement | null = null;
  private loadState: AudioLoadState = 'idle';
  private stopHandle: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.audio = new Audio();
    }
  }

  getLoadState(): AudioLoadState {
    return this.loadState;
  }

  private clearStopHandle(): void {
    if (this.stopHandle) {
      clearTimeout(this.stopHandle);
      this.stopHandle = null;
    }
  }

  /**
   * 播放指定音檔中 startSec 到 startSec + durationSec 的片段。
   * durationSec 省略時播放至音檔結束。
   * 音訊載入失敗時，loadState 設為 'error'，呼叫端需檢查此狀態並顯示對應 UI。
   */
  async playSegment(audioUrl: string, startSec: number, durationSec?: number): Promise<void> {
    if (!this.audio) return;
    this.clearStopHandle();
    this.loadState = 'loading';

    try {
      if (this.audio.src !== audioUrl) {
        this.audio.src = audioUrl;
      }
      this.audio.currentTime = startSec;
      await this.audio.play();
      this.loadState = 'ready';

      if (durationSec !== undefined) {
        this.stopHandle = setTimeout(() => {
          this.stop();
        }, durationSec * 1000);
      }
    } catch {
      this.loadState = 'error';
    }
  }

  stop(): void {
    this.clearStopHandle();
    if (this.audio) {
      this.audio.pause();
    }
  }

  dispose(): void {
    this.stop();
    this.audio = null;
  }
}
