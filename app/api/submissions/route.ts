import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { extractYoutubeVideoId } from '../../../lib/engine/youtubeUrl';
import { lookupYoutubeVideo } from '../../../lib/server/youtubeVideo';
import { loadDuplicateContext, runDuplicateCheck } from '../../../lib/server/submissionStore';
import { allowRequest, getClientIp } from '../../../lib/server/rateLimit';
import { sanitizeDisplayName } from '../../../lib/server/sanitizeName';

const MAX_TITLE = 100;
const MAX_ARTIST = 60;
const MAX_NOTE = 200;
/** 待審核上限：避免被洗版後審核區無法處理 */
const MAX_PENDING = 300;

function clean(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// POST /api/submissions  { url, title, artist, note?, submitterName, acknowledgeWarning? }
// 送出投稿。影片資訊與重複性一律由伺服器重新查詢、重新比對，不採信客戶端帶來的結果：
// block 等級一律拒絕；warn 等級需要 acknowledgeWarning=true（玩家看過警告後確認）才收件。
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!allowRequest(`submission-post:${ip}`, 6, 60 * 60 * 1000)) {
    return NextResponse.json({ error: '一小時內投稿次數已達上限，請稍後再試' }, { status: 429 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const videoId = extractYoutubeVideoId(typeof body.url === 'string' ? body.url : '');
    if (!videoId) {
      return NextResponse.json({ error: '無法辨識這個 YouTube 網址' }, { status: 400 });
    }
    const title = clean(body.title, MAX_TITLE);
    const artist = clean(body.artist, MAX_ARTIST);
    const note = clean(body.note, MAX_NOTE);
    const submitterName = sanitizeDisplayName(body.submitterName);
    if (!title) return NextResponse.json({ error: '請填寫歌名' }, { status: 400 });
    if (!artist) return NextResponse.json({ error: '請填寫歌手' }, { status: 400 });
    if (!submitterName) return NextResponse.json({ error: '請填寫暱稱' }, { status: 400 });

    const lookup = await lookupYoutubeVideo(videoId);
    if (!lookup.ok) {
      const status = lookup.reason === 'not-found' ? 404 : lookup.reason === 'not-configured' ? 503 : 502;
      const error =
        lookup.reason === 'not-found'
          ? '找不到這支影片，可能是私人或已刪除的影片'
          : lookup.reason === 'not-configured'
            ? '投稿功能暫時無法使用'
            : '查詢 YouTube 失敗，請稍後再試';
      return NextResponse.json({ error }, { status });
    }
    const video = lookup.info;

    const pendingCount = await prisma.songSubmission.count({ where: { status: 'pending' } });
    if (pendingCount >= MAX_PENDING) {
      return NextResponse.json({ error: '目前待審核的投稿過多，請稍後再來' }, { status: 503 });
    }

    const ctx = await loadDuplicateContext();
    const report = runDuplicateCheck(
      ctx,
      { videoId, rawTitle: video.title, channelTitle: video.channelTitle, title, artistName: artist },
      { embeddable: video.embeddable, durationSec: video.durationSec }
    );
    if (report.level === 'block') {
      return NextResponse.json(
        { error: report.reasons.find((r) => r.level === 'block')?.message ?? '這首歌無法投稿', report },
        { status: 409 }
      );
    }
    if (report.level === 'warn' && body.acknowledgeWarning !== true) {
      return NextResponse.json(
        { error: '請先確認重複性警告後再送出', needsAcknowledge: true, report },
        { status: 409 }
      );
    }

    const row = await prisma.songSubmission.create({
      data: {
        id: crypto.randomUUID(),
        youtubeVideoId: videoId,
        videoTitle: video.title,
        channelTitle: video.channelTitle,
        thumbnailUrl: video.thumbnailUrl,
        durationSec: video.durationSec,
        title,
        artistName: artist,
        note,
        submitterName,
        warning: report.reasons.map((r) => r.message).join(' '),
      },
      select: { id: true },
    });
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/submissions] 失敗：', err);
    return NextResponse.json({ error: '送出失敗，請稍後再試' }, { status: 500 });
  }
}
