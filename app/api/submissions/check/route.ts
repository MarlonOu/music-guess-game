import { NextRequest, NextResponse } from 'next/server';
import { extractYoutubeVideoId } from '../../../../lib/engine/youtubeUrl';
import { lookupYoutubeVideo } from '../../../../lib/server/youtubeVideo';
import { loadDuplicateContext, runDuplicateCheck, suggestFromVideo } from '../../../../lib/server/submissionStore';
import { allowRequest, getClientIp } from '../../../../lib/server/rateLimit';
import type { SubmissionCheckResponse } from '../../../../lib/types/submission';

// POST /api/submissions/check  { url, title?, artist? }
// 投稿前檢查：解析 YouTube 網址、取得影片資訊、建議歌名／歌手，並比對題庫與待審核投稿是否重複。
// title／artist 有帶時（玩家修改了歌名或歌手）以玩家填的值重新比對。
export async function POST(request: NextRequest) {
  if (!allowRequest(`submission-check:${getClientIp(request)}`, 40, 10 * 60 * 1000)) {
    return NextResponse.json({ error: '檢查太頻繁了，請稍後再試' }, { status: 429 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const url = typeof body.url === 'string' ? body.url : '';
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: '無法辨識這個網址，請貼上 YouTube 單一影片的網址（播放清單網址不適用）' },
        { status: 400 }
      );
    }

    const lookup = await lookupYoutubeVideo(videoId);
    if (!lookup.ok) {
      const map = {
        'not-configured': { status: 503, error: '投稿功能暫時無法使用（伺服器未設定 YouTube 金鑰）' },
        'not-found': { status: 404, error: '找不到這支影片，可能是私人或已刪除的影片' },
        upstream: { status: 502, error: '查詢 YouTube 失敗，請稍後再試' },
      } as const;
      const m = map[lookup.reason];
      return NextResponse.json({ error: m.error }, { status: m.status });
    }
    const video = lookup.info;

    const ctx = await loadDuplicateContext();
    const suggestion = suggestFromVideo(ctx.library, video);
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : suggestion.title;
    const artist = typeof body.artist === 'string' && body.artist.trim() ? body.artist.trim() : suggestion.artist;

    const report = runDuplicateCheck(
      ctx,
      { videoId, rawTitle: video.title, channelTitle: video.channelTitle, title, artistName: artist },
      { embeddable: video.embeddable, durationSec: video.durationSec }
    );
    const res: SubmissionCheckResponse = { video, suggestion, report };
    return NextResponse.json(res);
  } catch (err) {
    console.error('[POST /api/submissions/check] 失敗：', err);
    return NextResponse.json({ error: '檢查失敗，請稍後再試' }, { status: 500 });
  }
}
