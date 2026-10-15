import {
  DISPLAY_LANGUAGE,
  HAS_CJK,
  lookupChineseNames,
  parseIso8601Duration,
  pickLocalized,
  stripTopicSuffix,
} from './youtubeText';
import type { VideoInfo } from '../types/submission';

/** 單支影片的資訊查詢結果快取：投稿頁會在編輯歌名時重複檢查，不需要每次都消耗 YouTube 配額 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const g = globalThis as unknown as { __videoInfoCache?: Map<string, { at: number; info: VideoInfo | null }> };
const cache = (g.__videoInfoCache ??= new Map());

export type VideoLookup =
  | { ok: true; info: VideoInfo }
  | { ok: false; reason: 'not-configured' | 'not-found' | 'upstream' };

/**
 * 以 videos.list（1 unit）＋channels.list（1 unit）取得影片標題、頻道、長度與可嵌入狀態，
 * 標題與頻道名稱優先使用繁體中文在地化版本，與播放清單匯入一致。
 */
export async function lookupYoutubeVideo(videoId: string): Promise<VideoLookup> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { ok: false, reason: 'not-configured' };

  const hit = cache.get(videoId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.info ? { ok: true, info: hit.info } : { ok: false, reason: 'not-found' };
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'contentDetails,status,snippet,localizations');
    url.searchParams.set('hl', DISPLAY_LANGUAGE);
    url.searchParams.set('id', videoId);
    url.searchParams.set('key', apiKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error('[lookupYoutubeVideo] videos.list 錯誤：', res.status);
      return { ok: false, reason: 'upstream' };
    }
    const data = await res.json();
    const v = data.items?.[0];
    // 私人／已刪除的影片不會出現在結果裡；privacyStatus=private 也視為找不到
    if (!v || v.status?.privacyStatus === 'private') {
      cache.set(videoId, { at: Date.now(), info: null });
      return { ok: false, reason: 'not-found' };
    }

    let title: string = pickLocalized(v.localizations, v.snippet?.localized?.title) ?? v.snippet?.title ?? '';
    let channel: string = v.snippet?.channelTitle ?? '';
    const channelId: string | undefined = v.snippet?.channelId;
    if (channelId) {
      try {
        const cu = new URL('https://www.googleapis.com/youtube/v3/channels');
        cu.searchParams.set('part', 'snippet,localizations');
        cu.searchParams.set('hl', DISPLAY_LANGUAGE);
        cu.searchParams.set('id', channelId);
        cu.searchParams.set('key', apiKey);
        const cr = await fetch(cu, { signal: AbortSignal.timeout(6000) });
        if (cr.ok) {
          const c = (await cr.json()).items?.[0];
          const name = c ? pickLocalized(c.localizations, c.snippet?.localized?.title) : undefined;
          if (name) channel = name;
        }
      } catch {
        // 頻道在地化名稱查不到就沿用預設名稱
      }
    }
    channel = stripTopicSuffix(channel);
    const durationSec = parseIso8601Duration(v.contentDetails?.duration ?? '');

    // 自動產生的 Topic 影片常是拼音／英文，嘗試用 iTunes（長度驗證）補中文名稱
    if (!(HAS_CJK.test(title) && HAS_CJK.test(channel))) {
      const zh = await lookupChineseNames(channel, title, durationSec);
      if (zh) {
        title = zh.title;
        channel = zh.artist;
      }
    }

    const info: VideoInfo = {
      videoId,
      title,
      channelTitle: channel,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      durationSec,
      embeddable: v.status?.embeddable ?? true,
    };
    if (cache.size > 500) cache.clear();
    cache.set(videoId, { at: Date.now(), info });
    return { ok: true, info };
  } catch (err) {
    console.error('[lookupYoutubeVideo] 失敗：', err);
    return { ok: false, reason: 'upstream' };
  }
}
