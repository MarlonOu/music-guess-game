import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { HealthScanError, scanPlatform } from '../../../../../lib/server/sourceHealth';
import type { HealthPlatform } from '../../../../../lib/types/sourceHealth';

const MAX_IDS = 50;

// POST /api/admin/source-health/scan  { platform: 'youtube'|'apple'|'deezer', songIds: string[] }
// 管理用（/api/admin 受 proxy.ts 驗證保護）：檢查這批歌曲在指定平台的來源狀態，只讀取、不寫入。
// 由管理頁分批呼叫（每批最多 50 首），避免單一請求超過 Cloudflare Tunnel 的回應時間上限。
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { platform?: unknown; songIds?: unknown };
  const platform = body.platform;
  if (platform !== 'youtube' && platform !== 'apple' && platform !== 'deezer') {
    return NextResponse.json({ error: 'platform 必須是 youtube、apple 或 deezer' }, { status: 400 });
  }
  const songIds = Array.isArray(body.songIds) ? body.songIds.filter((x): x is string => typeof x === 'string').slice(0, MAX_IDS) : [];
  if (songIds.length === 0) return NextResponse.json({ error: '缺少 songIds' }, { status: 400 });

  try {
    const songs = await prisma.song.findMany({
      where: { id: { in: songIds } },
      select: {
        id: true,
        title: true,
        youtubeVideoId: true,
        appleMusicTrackId: true,
        appleMusicPreviewUrl: true,
        deezerTrackId: true,
        deezerPreviewUrl: true,
      },
    });
    const result = await scanPlatform(platform as HealthPlatform, songs);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HealthScanError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[POST /api/admin/source-health/scan] 失敗：', err);
    return NextResponse.json({ error: '掃描失敗' }, { status: 500 });
  }
}
