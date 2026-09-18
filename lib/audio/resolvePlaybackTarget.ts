import type { AudioSource } from './audioController';

export interface PlaybackTarget {
  source: AudioSource;
  /** source='youtube' 時是 YouTube 影片 id；source='apple' 時是 Apple Music 試聽片段網址 */
  idOrUrl: string;
  startSec: number;
  durationSec?: number;
}

interface PlayableSong {
  youtubeVideoId?: string | null;
  appleMusicPreviewUrl?: string | null;
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
 * 優先序：Apple Music 試聽優先於 YouTube。理由是 Apple Music 用同源的原生 <audio> 元素播放，
 * 不像 YouTube IFrame 是跨網域的第三方播放器，能真正控制／隱藏系統的正在播放資訊
 * （見 AudioController.updateMediaSession() 的說明），不會被手機/電腦控制中心顯示出真正的
 * 歌名而洩漏答案。只有在這首歌完全沒有 Apple Music 試聽來源時，才退回用 YouTube。
 *
 * 已知取捨：Apple 官方試聽是「固定的一段」（通常從歌曲某個固定秒數開始、長度固定在 30 秒
 * 上下），不像 YouTube 完整影片可以任意指定開始秒數。因此用 Apple 來源播放時，一律從試聽
 * 片段本身的開頭（0 秒）開始，不套用原本針對「完整歌曲」計算出來的 clipStartSec——那個數字
 * 是相對於完整歌曲長度算的隨機片段起點，套在只有 30 秒的試聽片段上沒有意義，甚至可能超出
 * 片段本身的長度。這代表 RANDOM_CLIP 模式用 Apple 來源播放時，實際上會是「試聽片段的前幾秒」
 * 而非真正隨機的片段——這是目前的已知限制，如果想在 Apple 來源下也保留隨機性，需要額外記錄
 * 每個試聽片段自己的實際長度（Apple 沒有公開固定保證是 30 秒，實際會依歌曲略有差異），
 * 之後可以再優化，屬於後續加強項目。
 *
 * 回傳 null 代表這首歌兩種來源都沒有（理論上不該發生，後台表單與 CSV 匯入都要求至少一種
 * 來源存在；回傳 null 純粹是防呆，呼叫端應顯示「找不到可播放的音源」而不是嘗試播放）。
 */
export function resolvePlaybackTarget(song: PlayableSong, question: PlayableQuestion): PlaybackTarget | null {
  if (question.renderType === 'text-lyric') return null;

  if (song.appleMusicPreviewUrl) {
    const durationSec = question.renderType === 'audio-intro' ? question.introEndSec : question.clipDurationSec;
    return { source: 'apple', idOrUrl: song.appleMusicPreviewUrl, startSec: 0, durationSec };
  }

  if (song.youtubeVideoId) {
    if (question.renderType === 'audio-intro') {
      return { source: 'youtube', idOrUrl: song.youtubeVideoId, startSec: 0, durationSec: question.introEndSec };
    }
    return {
      source: 'youtube',
      idOrUrl: song.youtubeVideoId,
      startSec: question.clipStartSec ?? 0,
      durationSec: question.clipDurationSec,
    };
  }

  return null;
}
