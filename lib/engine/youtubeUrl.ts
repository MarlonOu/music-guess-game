/**
 * 從各種 YouTube 網址格式取出 11 碼影片 id（純函式，前後端共用）。
 * 支援 watch?v=、youtu.be/、shorts/、embed/、live/、v/，以及 music.youtube.com、m.youtube.com；
 * 也接受直接貼上 11 碼 id。只有播放清單網址（沒有影片 id）回傳 null。
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = /^(?:www\.|m\.|music\.|gaming\.)?youtube(?:-nocookie)?\.com$/i;

export function extractYoutubeVideoId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (VIDEO_ID.test(text)) return text;

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }
  if (!YT_HOSTS.test(host)) return null;

  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;
  const m = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/.exec(url.pathname);
  return m ? m[1] : null;
}
