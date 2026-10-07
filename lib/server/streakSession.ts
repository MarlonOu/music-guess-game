import { randomUUID } from 'node:crypto';
import { isAnswerCorrect } from '../engine/answerUtils';
import { getRandomClipStart, DEFAULT_CLIP_DURATION_SEC } from '../engine/modes/randomClipMode';
import { resolvePlaybackTargets, type PlaybackTarget } from '../audio/resolvePlaybackTarget';
import { STREAK_STAGES_SEC, STREAK_CLIP_SEC, STREAK_MIN_GUESS_MS, streakPointsForStage } from '../constants/streak';
import type { StreakAnswer, StreakPlayback, StreakQuestion } from '../types/streak';

/**
 * 無限連勝模式進行中的挑戰狀態，存在伺服器記憶體（理由同 speedrunSession.ts：單人挑戰，
 * 不需要跨裝置同步，也不需要跨重啟存活）。
 *
 * 防作弊核心：
 * - 答案（歌名、歌手、哪一首歌）從頭到尾只存在這裡。客戶端只拿得到「這一段要播什麼」，
 *   猜測交給 /api/streak/guess 由伺服器判定，連勝與分數也由伺服器累計，不採信客戶端回報。
 * - 答錯、按「多聽」都由伺服器推進段落；分數依伺服器記錄的段落計算。
 * - 題目結束（答對／失敗／放棄）之前，不會回傳歌名、歌手或歌曲 id。
 * - 成績只能在挑戰結束後送出一次（finalize 之後 session 即刪除）。
 */
export interface StreakPoolSong {
  id: string;
  title: string;
  artistName: string;
  aliases: string[];
  durationSec: number;
  youtubeVideoId?: string | null;
  appleMusicPreviewUrl?: string | null;
  deezerPreviewUrl?: string | null;
}

interface CurrentQuestion {
  song: StreakPoolSong;
  clipStartSec: number;
  stage: number;
  /** 目前這一段被送出（題目開始、猜錯或按多聽解鎖新一段）的伺服器時間戳 */
  stageServedAt: number;
  wrong: string[];
  resolved: 'open' | 'correct' | 'failed';
}

interface StreakSession {
  pool: StreakPoolSong[];
  poolById: Map<string, StreakPoolSong>;
  used: Set<string>;
  startedAt: number;
  streak: number;
  score: number;
  current: CurrentQuestion | null;
  over: boolean;
}

const globalForStreak = globalThis as unknown as { __streakSessions?: Map<string, StreakSession> };
const sessions = (globalForStreak.__streakSessions ??= new Map<string, StreakSession>());

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function cleanupExpired(): void {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.startedAt > SESSION_TTL_MS) sessions.delete(token);
  }
}

function clipQuestionFor(song: StreakPoolSong, clipStartSec: number) {
  return { renderType: 'audio-clip' as const, clipStartSec, clipDurationSec: STREAK_CLIP_SEC };
}

/** 這首歌在無限連勝（隨機片段）下是否有可播放來源 */
export function isStreakPlayable(song: Pick<StreakPoolSong, 'youtubeVideoId' | 'appleMusicPreviewUrl' | 'deezerPreviewUrl'>): boolean {
  return resolvePlaybackTargets(song, { renderType: 'audio-clip', clipStartSec: 0, clipDurationSec: STREAK_CLIP_SEC }).length > 0;
}

function toPlayback(
  targets: PlaybackTarget[],
  durationSec: number | undefined
): StreakPlayback | null {
  const primary = targets[0];
  if (!primary) return null;
  const fb = targets.find((t) => t.source !== primary.source) ?? null;
  return {
    source: primary.source,
    idOrUrl: primary.idOrUrl,
    startSec: primary.startSec,
    durationSec: durationSec ?? 0,
    fallback: fb ? { source: fb.source, idOrUrl: fb.idOrUrl, startSec: fb.startSec, durationSec } : null,
  };
}

function buildQuestion(session: StreakSession): StreakQuestion {
  const cur = session.current!;
  const targets = resolvePlaybackTargets(cur.song, clipQuestionFor(cur.song, cur.clipStartSec));
  const playback = toPlayback(targets, STREAK_STAGES_SEC[cur.stage])!;
  return { number: session.streak + 1, stage: cur.stage, wrong: [...cur.wrong], playback };
}

function buildAnswer(cur: CurrentQuestion): StreakAnswer {
  const targets = resolvePlaybackTargets(cur.song, clipQuestionFor(cur.song, cur.clipStartSec));
  const reveal = toPlayback(targets, undefined);
  return { songId: cur.song.id, title: cur.song.title, artist: cur.song.artistName, reveal };
}

function pickNext(session: StreakSession): boolean {
  const remaining = session.pool.filter((s) => !session.used.has(s.id));
  if (remaining.length === 0) {
    session.current = null;
    return false;
  }
  const song = remaining[Math.floor(Math.random() * remaining.length)];
  session.used.add(song.id);
  const effective = song.durationSec > 0 ? song.durationSec : DEFAULT_CLIP_DURATION_SEC;
  const clipDuration = Math.min(STREAK_CLIP_SEC, effective);
  session.current = {
    song,
    clipStartSec: getRandomClipStart(effective, clipDuration),
    stage: 0,
    stageServedAt: Date.now(),
    wrong: [],
    resolved: 'open',
  };
  return true;
}

export function createStreakSession(pool: StreakPoolSong[]): { token: string; question: StreakQuestion } | null {
  cleanupExpired();
  const playable = pool.filter(isStreakPlayable);
  if (playable.length === 0) return null;
  const session: StreakSession = {
    pool: playable,
    poolById: new Map(playable.map((s) => [s.id, s])),
    used: new Set(),
    startedAt: Date.now(),
    streak: 0,
    score: 0,
    current: null,
    over: false,
  };
  pickNext(session);
  const token = randomUUID();
  sessions.set(token, session);
  return { token, question: buildQuestion(session) };
}

type GuessInput = { songId?: string; text?: string };

export type StreakGuessResult =
  | {
      result: 'correct' | 'failed';
      answer: StreakAnswer;
      gain: number;
      streak: number;
      score: number;
      over: boolean;
      guessLabel?: string;
    }
  | { result: 'wrong'; question: StreakQuestion; guessLabel: string; streak: number; score: number; over: false }
  | { result: 'tooFast'; retryAfterMs: number };

/** 判定一次猜測。回傳 null 代表 token 無效、挑戰已結束或目前沒有進行中的題目。 */
export function guessStreak(token: string, input: GuessInput): StreakGuessResult | null {
  const session = sessions.get(token);
  if (!session || session.over || !session.current || session.current.resolved !== 'open') return null;
  const cur = session.current;

  // 防腳本：每一段送出後至少要過 STREAK_MIN_GUESS_MS 才接受猜測。真人要按播放、聽到聲音、
  // 辨認、輸入，不可能比這更快；沒有這個下限，知道答案的程式可以毫秒級連續答對。
  const sinceServed = Date.now() - cur.stageServedAt;
  if (sinceServed < STREAK_MIN_GUESS_MS) {
    return { result: 'tooFast', retryAfterMs: STREAK_MIN_GUESS_MS - sinceServed };
  }

  let guessLabel = '';
  let correct = false;
  if (input.songId) {
    const guessed = session.poolById.get(input.songId);
    if (!guessed) return null;
    guessLabel = guessed.title;
    // 同一首歌，或歌名（含別名、去版本標記）判定為相同，都算對——例如同名的不同版本重複收錄
    correct = guessed.id === cur.song.id || isAnswerCorrect(guessed.title, cur.song.title, cur.song.aliases);
  } else if (typeof input.text === 'string' && input.text.trim()) {
    guessLabel = input.text.trim().slice(0, 60);
    correct = isAnswerCorrect(guessLabel, cur.song.title, cur.song.aliases);
  } else {
    return null;
  }

  if (correct) {
    const gain = streakPointsForStage(cur.stage);
    session.streak += 1;
    session.score += gain;
    cur.resolved = 'correct';
    return { result: 'correct', answer: buildAnswer(cur), gain, streak: session.streak, score: session.score, over: false };
  }

  cur.wrong.push(guessLabel);
  if (cur.stage >= STREAK_STAGES_SEC.length - 1) {
    cur.resolved = 'failed';
    session.over = true;
    return { result: 'failed', answer: buildAnswer(cur), gain: 0, streak: session.streak, score: session.score, over: true, guessLabel };
  }
  cur.stage += 1;
  cur.stageServedAt = Date.now();
  return { result: 'wrong', question: buildQuestion(session), guessLabel, streak: session.streak, score: session.score, over: false };
}

/** 「多聽」：不猜，直接解鎖下一段。最後一段沒有下一段，回傳 null。 */
export function skipStreakStage(token: string): StreakQuestion | null {
  const session = sessions.get(token);
  if (!session || session.over || !session.current || session.current.resolved !== 'open') return null;
  const cur = session.current;
  if (cur.stage >= STREAK_STAGES_SEC.length - 1) return null;
  cur.stage += 1;
  cur.stageServedAt = Date.now();
  return buildQuestion(session);
}

/** 直接公布答案：視為失敗，挑戰結束。 */
export function giveUpStreak(token: string): { answer: StreakAnswer; streak: number; score: number } | null {
  const session = sessions.get(token);
  if (!session || session.over || !session.current || session.current.resolved !== 'open') return null;
  session.current.resolved = 'failed';
  session.over = true;
  return { answer: buildAnswer(session.current), streak: session.streak, score: session.score };
}

/** 答對後進入下一首。題庫全部猜完時挑戰結束（over = true）。 */
export function nextStreakQuestion(
  token: string
): { question: StreakQuestion | null; over: boolean; streak: number; score: number } | null {
  const session = sessions.get(token);
  if (!session || session.over || !session.current || session.current.resolved !== 'correct') return null;
  if (!pickNext(session)) {
    session.over = true;
    return { question: null, over: true, streak: session.streak, score: session.score };
  }
  return { question: buildQuestion(session), over: false, streak: session.streak, score: session.score };
}

/** 挑戰結束後交出最終成績，同時刪除 session（一次性）。 */
export function finalizeStreakSession(token: string): { streak: number; score: number } | null {
  const session = sessions.get(token);
  if (!session || !session.over) return null;
  sessions.delete(token);
  return { streak: session.streak, score: session.score };
}

/** 答對後選擇「結束挑戰」：把目前累積的連勝與分數結算（不必等到猜錯）。 */
export function endStreak(token: string): { streak: number; score: number } | null {
  const session = sessions.get(token);
  if (!session || session.over || !session.current || session.current.resolved !== 'correct') return null;
  session.over = true;
  return { streak: session.streak, score: session.score };
}
