import { NextRequest, NextResponse } from 'next/server';
import { allowRequest, getClientIp } from '../../../../lib/server/rateLimit';
import { prisma } from '../../../../lib/db';
import { createSpeedrunSession } from '../../../../lib/server/speedrunSession';
import { buildChoiceSongIds, CHOICES_PER_ROUND } from '../../../../lib/server/choiceMode';
import { getRandomClipStart, DEFAULT_CLIP_DURATION_SEC } from '../../../../lib/engine/modes/randomClipMode';
import { resolvePlaybackTarget, resolvePlaybackFallback } from '../../../../lib/audio/resolvePlaybackTarget';
import { deezerPlayPath } from '../../../../lib/server/deezerPreview';
import type { SpeedrunQuestion } from '../../../../lib/types/speedrun';

const QUESTION_COUNT = 10;

// POST /api/speedrun/start → 開始一場速通挑戰：隨機片段猜歌＋選擇題搶答，10 題。
// 一次把全部 10 題的播放資訊與選項算好回傳給客戶端，不像線上模式那樣需要逐題輪詢
// （這是單人挑戰，沒有其他玩家需要同步進度，沒有輪詢的必要）。
// 每題不含「哪個選項才是正解」，真相只存在伺服器記憶體裡（見 lib/server/speedrunSession.ts），
// 之後每答一題都要呼叫 /api/speedrun/check 讓伺服器判定，不是客戶端自己比對。
export async function POST(request: NextRequest) {
  // 每個 IP 每分鐘最多開 8 場，擋掉用腳本大量開場、蒐集題目的行為
  if (!allowRequest(`speedrun-start:${getClientIp(request)}`, 8, 60_000)) {
    return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 });
  }
  try {
    const songs = await prisma.song.findMany({ include: { themes: { select: { themeId: true } } } });
    const pool = songs.map((s) => ({
      id: s.id,
      title: s.title,
      artistId: s.artistId,
      durationSec: s.durationSec,
      youtubeVideoId: s.youtubeVideoId,
      appleMusicPreviewUrl: s.appleMusicPreviewUrl,
      // 題目要隱藏歌曲身分，所以只給加密過的站內播放路徑，不給原始網址與 track id
      deezerPlayUrl: deezerPlayPath(s.deezerTrackId) ?? s.deezerPreviewUrl,
      themeIds: s.themes.map((t: { themeId: string }) => t.themeId),
    }));

    if (pool.length < CHOICES_PER_ROUND) {
      return NextResponse.json(
        { error: `題庫歌曲數量不足（至少需要 ${CHOICES_PER_ROUND} 首才能出選擇題）` },
        { status: 400 }
      );
    }

    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(QUESTION_COUNT, pool.length));
    const choiceSongIds = buildChoiceSongIds(shuffled, pool);

    const choiceSongsFlat = await prisma.song.findMany({
      where: { id: { in: choiceSongIds.filter((id: string) => id.length > 0) } },
      select: { id: true, title: true },
    });
    const titleById = new Map(choiceSongsFlat.map((s: { id: string; title: string }) => [s.id, s.title]));

    const questions: SpeedrunQuestion[] = shuffled.map((song, i) => {
      const effectiveDuration = song.durationSec > 0 ? song.durationSec : DEFAULT_CLIP_DURATION_SEC;
      const clipDurationSec = Math.min(DEFAULT_CLIP_DURATION_SEC, effectiveDuration);
      const clipStartSec = getRandomClipStart(effectiveDuration, clipDurationSec);
      const clipQuestion = { renderType: 'audio-clip' as const, clipStartSec, clipDurationSec };
      const target = resolvePlaybackTarget(song, clipQuestion);
      const fallbackTarget = resolvePlaybackFallback(song, clipQuestion);

      const roundChoiceIds = choiceSongIds
        .slice(i * CHOICES_PER_ROUND, (i + 1) * CHOICES_PER_ROUND)
        .filter((id: string) => id.length > 0);
      const choices = roundChoiceIds
        .map((id: string) => ({ songId: id, title: titleById.get(id) }))
        .filter((c: { songId: string; title: string | undefined }): c is { songId: string; title: string } =>
          Boolean(c.title)
        );

      return {
        source: target?.source ?? null,
        playbackId: target?.idOrUrl ?? null,
        startSec: target?.startSec ?? 0,
        durationSec: target?.durationSec,
        fallback: fallbackTarget
          ? {
              source: fallbackTarget.source,
              idOrUrl: fallbackTarget.idOrUrl,
              startSec: fallbackTarget.startSec,
              durationSec: fallbackTarget.durationSec,
            }
          : null,
        choices,
      };
    });

    if (questions.some((q) => !q.source || q.choices.length < 2)) {
      return NextResponse.json({ error: '題庫目前無法組出完整的選擇題，請確認歌曲都有可播放來源' }, { status: 400 });
    }

    const { token } = createSpeedrunSession(shuffled.map((s) => s.id));

    return NextResponse.json({ token, questions });
  } catch (err) {
    console.error('[POST /api/speedrun/start] 開始挑戰失敗：', err);
    return NextResponse.json({ error: '開始挑戰失敗' }, { status: 500 });
  }
}
