import { prisma } from '../db';
import type { MatchableSong } from '../engine/songMatch';
import {
  buildSongMatchIndex,
  artistHintsFor,
  suggestSongFields,
  suggestArtistName,
} from '../engine/songMatch';
import {
  evaluateDuplicates,
  type RejectedRef,
  type SubmissionCandidate,
  type VideoRules,
} from '../engine/submissionDuplicates';
import type { DuplicateReport, SongSubmissionView } from '../types/submission';

interface SubmissionRow {
  id: string;
  youtubeVideoId: string;
  videoTitle: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSec: number;
  title: string;
  artistName: string;
  note: string;
  submitterName: string;
  status: string;
  warning: string;
  reviewNote: string;
  songId: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

export function toSubmissionView(r: SubmissionRow, report?: DuplicateReport): SongSubmissionView {
  return {
    id: r.id,
    youtubeVideoId: r.youtubeVideoId,
    videoTitle: r.videoTitle,
    channelTitle: r.channelTitle,
    thumbnailUrl: r.thumbnailUrl,
    durationSec: r.durationSec,
    title: r.title,
    artistName: r.artistName,
    note: r.note,
    submitterName: r.submitterName,
    status: r.status as SongSubmissionView['status'],
    warning: r.warning,
    reviewNote: r.reviewNote,
    songId: r.songId,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    report,
  };
}

/** 載入重複性檢查需要的三份資料：題庫、待審核投稿、被退回的投稿 */
export async function loadDuplicateContext(): Promise<{
  library: MatchableSong[];
  pending: (MatchableSong & { submissionId: string })[];
  rejected: RejectedRef[];
}> {
  const [songs, subs] = await Promise.all([
    prisma.song.findMany({
      select: { id: true, title: true, aliases: true, youtubeVideoId: true, artist: { select: { name: true } } },
    }),
    prisma.songSubmission.findMany({
      where: { status: { in: ['pending', 'rejected'] } },
      select: { id: true, status: true, youtubeVideoId: true, title: true, artistName: true, reviewNote: true },
    }),
  ]);
  return {
    library: songs.map((s) => ({
      id: s.id,
      title: s.title,
      aliases: s.aliases,
      artistName: s.artist.name,
      youtubeVideoId: s.youtubeVideoId ?? undefined,
    })),
    pending: subs
      .filter((s) => s.status === 'pending')
      .map((s) => ({
        id: s.id,
        submissionId: s.id,
        title: s.title,
        aliases: [],
        artistName: s.artistName,
        youtubeVideoId: s.youtubeVideoId,
      })),
    rejected: subs
      .filter((s) => s.status === 'rejected')
      .map((s) => ({ youtubeVideoId: s.youtubeVideoId, title: s.title, artistName: s.artistName, reviewNote: s.reviewNote })),
  };
}

export function suggestFromVideo(
  library: MatchableSong[],
  video: { title: string; channelTitle: string }
): { title: string; artist: string } {
  const index = buildSongMatchIndex(library);
  const hints = artistHintsFor(index, video.title, video.channelTitle);
  return {
    title: suggestSongFields(video.title, hints).title,
    artist: suggestArtistName(index, video.title, video.channelTitle),
  };
}

export function runDuplicateCheck(
  ctx: Awaited<ReturnType<typeof loadDuplicateContext>>,
  candidate: SubmissionCandidate,
  rules?: VideoRules,
  excludeSubmissionId?: string
): DuplicateReport {
  const pending = excludeSubmissionId ? ctx.pending.filter((p) => p.submissionId !== excludeSubmissionId) : ctx.pending;
  return evaluateDuplicates(candidate, ctx.library, pending, ctx.rejected, rules);
}
