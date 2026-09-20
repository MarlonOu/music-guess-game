import type { AudioSource } from './audioController';

export interface PlaybackTarget {
  source: AudioSource;
  /** source='youtube' 時是 YouTube 影片 id；source='apple'／'deezer' 時是官方試聽片段網址 */
  idOrUrl: string;
  startSec: number;
  durationSec?: number;
}

interface PlayableSong {
  youtubeVideoId?: string | null;
  appleMusicPreviewUrl?: string | null;
  deezerPreviewUrl?: string | null;
}

interface PlayableQuestion {
  renderType: 'audio-intro' | 'audio-clip' | 'text-lyric';
  introEndSec?: number;
  clipStartSec?: number;
  clipDurationSec?: number;
}

/**
 * 決定一首歌實際要用哪個來源播放、從第幾秒開始播放多久。
 *
 * 重要：Apple Music／Deezer 只用在 RANDOM_CLIP（audio-clip）模式，INTRO（audio-intro）模式
 * 一律優先用 YouTube。原因：Apple／Deezer 的官方試聽片段是「精選片段」（常常直接從副歌或
 * 歌曲最抓耳的段落開始，不保證是歌曲真正的開頭），拿來當「前奏」播放會讓「前奏猜歌」這個
 * 模式失去意義——玩家聽到的可能根本是副歌，不是前奏。RANDOM_CLIP 模式則完全沒有這個問題：
 * 本來就只是要放「一小段片段」讓人猜，不要求一定要是歌曲的哪個特定位置，用官方精選片段完全
 * 合理，還能換來控制中心不洩漏答案的好處（見下方優先序說明）。
 *
 * RANDOM_CLIP 模式的優先序：Apple Music → Deezer → YouTube。前兩者都用同源的原生 <audio>
 * 元素播放，不像 YouTube IFrame 是跨網域的第三方播放器，能真正控制／隱藏系統的正在播放資訊
 * （見 AudioController.updateMediaSession() 的說明），不會被手機/電腦控制中心顯示出真正的
 * 歌名而洩漏答案。Deezer 是 Apple Music 目錄沒收錄這首歌時的第二層備援（兩個目錄不完全重疊，
 * 各自會有對方沒有的冷門/地區限定歌曲）。
 *
 * INTRO 模式的來源選擇：優先用 YouTube（可以指定從第 0 秒開始，保證是真正的前奏）；只有這首歌
 * 完全沒有 YouTube 來源時，才退而求其次用 Apple／Deezer 的試聽片段頂著——雖然不是真正的前奏，
 * 至少還能播放，好過這首歌在 INTRO 模式下完全沒得玩。管理歌曲時如果知道會用在前奏猜歌，
 * 建議盡量幫這首歌補上 YouTube 來源，才能保證前奏播放正確。
 *
 * 已知取捨：Apple／Deezer 官方試聽都是「固定的一段」（通常長度固定在 30 秒上下），不像
 * YouTube 完整影片可以任意指定開始秒數。因此用這兩個來源播放時，一律從試聽片段本身的開頭
 * （0 秒）開始，不套用原本針對「完整歌曲」計算出來的 clipStartSec——那個數字是相對於完整
 * 歌曲長度算的隨機片段起點，套在只有 30 秒的試聽片段上沒有意義。這代表 RANDOM_CLIP 模式用
 * 這兩個來源播放時，實際上會是「試聽片段的前幾秒」而非真正隨機的片段——這是目前的已知限制，
 * 如果想保留隨機性，需要額外記錄每個試聽片段自己的實際長度，之後可以再優化。
 *
 * 回傳 null 代表這首歌在這個模式下找不到可用的來源（理論上不該發生於 RANDOM_CLIP，因為
 * 三種來源至少會有一種；INTRO 模式下如果這首歌完全沒有任何來源才會發生）。
 */
export function resolvePlaybackTarget(song: PlayableSong, question: PlayableQuestion): PlaybackTarget | null {
  if (question.renderType === 'text-lyric') return null;

  const nativeAudioUrl = song.appleMusicPreviewUrl || song.deezerPreviewUrl;
  const nativeSource: AudioSource | null = song.appleMusicPreviewUrl ? 'apple' : song.deezerPreviewUrl ? 'deezer' : null;

  if (question.renderType === 'audio-intro') {
    if (song.youtubeVideoId) {
      return { source: 'youtube', idOrUrl: song.youtubeVideoId, startSec: 0, durationSec: question.introEndSec };
    }
    // 沒有 YouTube 來源時的退路：至少讓這首歌還能播放，即使播出來的不是真正的前奏
    if (nativeAudioUrl && nativeSource) {
      return { source: nativeSource, idOrUrl: nativeAudioUrl, startSec: 0, durationSec: question.introEndSec };
    }
    return null;
  }

  // RANDOM_CLIP（audio-clip）：Apple Music／Deezer 真正發揮優勢的地方
  if (nativeAudioUrl && nativeSource) {
    return { source: nativeSource, idOrUrl: nativeAudioUrl, startSec: 0, durationSec: question.clipDurationSec };
  }

  if (song.youtubeVideoId) {
    return {
      source: 'youtube',
      idOrUrl: song.youtubeVideoId,
      startSec: question.clipStartSec ?? 0,
      durationSec: question.clipDurationSec,
    };
  }

  return null;
}
