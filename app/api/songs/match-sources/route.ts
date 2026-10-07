import { NextRequest, NextResponse } from 'next/server';
import { matchSource, type SourceMode, type SourcePlatform } from '../../../../lib/server/sourceMatch';

// POST /api/songs/match-sources → 針對「一首歌」查詢 Apple Music／Deezer 試聽來源，只回傳結果、不寫入資料庫。
// 由 /admin 的「批次比對來源」逐首呼叫（每首歌一個請求，避免單一請求跑太久），管理者核對後才用既有的
// 更新歌曲 API 套用。POST 屬於 /api/songs 的非 GET 請求，會經過 proxy.ts 的管理者驗證。
// 對外部 API 的請求節流在 lib/server/sourceMatch.ts 統一處理。
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求內容不是有效的 JSON' }, { status: 400 });
  }
  const platform = body.platform as SourcePlatform;
  const mode = body.mode as SourceMode;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
  if (platform !== 'apple' && platform !== 'deezer') {
    return NextResponse.json({ error: 'platform 必須是 apple 或 deezer' }, { status: 400 });
  }
  if (mode !== 'fill' && mode !== 'refresh') {
    return NextResponse.json({ error: 'mode 必須是 fill 或 refresh' }, { status: 400 });
  }
  if (!title || !artist) {
    return NextResponse.json({ error: '缺少歌名或歌手' }, { status: 400 });
  }
  const aliases = Array.isArray(body.aliases) ? body.aliases.filter((a): a is string => typeof a === 'string').slice(0, 20) : [];
  const result = await matchSource({
    platform,
    mode,
    title,
    artist,
    aliases,
    durationSec: typeof body.durationSec === 'number' ? body.durationSec : undefined,
    trackId: typeof body.trackId === 'string' ? body.trackId : undefined,
    country: typeof body.country === 'string' ? body.country : undefined,
  });
  return NextResponse.json(result);
}
