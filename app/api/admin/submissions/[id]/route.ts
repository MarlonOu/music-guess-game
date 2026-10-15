import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { normalizeForMatch } from '../../../../../lib/engine/songMatch';

type Params = { params: Promise<{ id: string }> };

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

// PATCH /api/admin/submissions/:id（受 proxy.ts 保護）
//   { action: 'approve', title, artistName, aliases?, themeIds? } → 建立歌曲並標記通過
//   { action: 'reject', reviewNote? }                              → 退回
//   { action: 'reopen' }                                           → 退回改回待審核
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const sub = await prisma.songSubmission.findUnique({ where: { id } });
    if (!sub) return NextResponse.json({ error: '找不到這筆投稿' }, { status: 404 });

    if (body.action === 'reject') {
      if (sub.status === 'approved') {
        return NextResponse.json({ error: '已通過的投稿不能退回，請到歌曲清單處理' }, { status: 409 });
      }
      await prisma.songSubmission.update({
        where: { id },
        data: { status: 'rejected', reviewNote: clean(body.reviewNote, 200), reviewedAt: new Date() },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'reopen') {
      if (sub.status !== 'rejected') return NextResponse.json({ error: '只有已退回的投稿可以重新審核' }, { status: 409 });
      await prisma.songSubmission.update({
        where: { id },
        data: { status: 'pending', reviewNote: '', reviewedAt: null },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'approve') {
      if (sub.status === 'approved') return NextResponse.json({ error: '這筆投稿已經通過' }, { status: 409 });
      const title = clean(body.title, 100);
      const artistName = clean(body.artistName, 60);
      if (!title || !artistName) return NextResponse.json({ error: '歌名與歌手都要填寫' }, { status: 400 });

      // 通過當下再確認一次：同一支影片已在題庫就不能重複建立
      const existing = await prisma.song.findFirst({
        where: { youtubeVideoId: sub.youtubeVideoId },
        select: { title: true },
      });
      if (existing) {
        return NextResponse.json({ error: `題庫已經收錄這支影片（${existing.title}）` }, { status: 409 });
      }

      const aliases: string[] = Array.isArray(body.aliases)
        ? body.aliases.filter((a: unknown): a is string => typeof a === 'string' && a.trim().length > 0).map((a: string) => a.trim())
        : [];
      const themeIds: string[] = Array.isArray(body.themeIds)
        ? body.themeIds.filter((t: unknown): t is string => typeof t === 'string')
        : [];

      // 歌手以正規化名稱比對既有資料，避免因全半形／大小寫／空白差異多建一個重複歌手
      const artists = await prisma.artist.findMany({ select: { id: true, name: true } });
      const key = normalizeForMatch(artistName);
      let artistId = artists.find((a: { id: string; name: string }) => normalizeForMatch(a.name) === key)?.id;
      if (!artistId) {
        artistId = crypto.randomUUID();
        await prisma.artist.create({ data: { id: artistId, name: artistName, gender: 'UNKNOWN' } });
      }

      const songId = crypto.randomUUID();
      await prisma.$transaction([
        prisma.song.create({
          data: {
            id: songId,
            title,
            artistId,
            youtubeVideoId: sub.youtubeVideoId,
            durationSec: sub.durationSec,
            lyrics: '',
            aliases,
            themes: themeIds.length > 0 ? { create: themeIds.map((themeId) => ({ themeId })) } : undefined,
          },
        }),
        prisma.songSubmission.update({
          where: { id },
          data: { status: 'approved', songId, title, artistName, reviewedAt: new Date(), reviewNote: '' },
        }),
      ]);
      return NextResponse.json({ ok: true, songId });
    }

    return NextResponse.json({ error: '不支援的操作' }, { status: 400 });
  } catch (err) {
    console.error('[PATCH /api/admin/submissions/:id] 失敗：', err);
    return NextResponse.json({ error: '操作失敗' }, { status: 500 });
  }
}

// DELETE /api/admin/submissions/:id → 刪除投稿紀錄（不影響已建立的歌曲）
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await prisma.songSubmission.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/admin/submissions/:id] 失敗：', err);
    return NextResponse.json({ error: '刪除失敗' }, { status: 500 });
  }
}
