import { randomUUID } from 'node:crypto';
import { SPEEDRUN_TRANSITION_SEC } from '../constants/speedrun';

/**
 * 速通模式（單機、隨機片段猜歌＋選擇題搶答，10 題計時）進行中的挑戰狀態。
 *
 * 刻意存在伺服器記憶體，不寫資料庫：這是單人挑戰，不是像線上模式那樣需要多裝置同步的
 * 房間狀態，也不需要跨伺服器重啟存活（重啟時剛好在挑戰中的人，重新整理頁面重新開始即可，
 * 影響範圍很小）。只有「挑戰完成、成績確定下來」的那一刻，才真正寫進 SpeedrunScore 資料表
 * （見 app/api/speedrun/submit/route.ts）。
 *
 * 核心設計：完成時間（totalTimeMs）由伺服器依這裡記錄的 startedAt／finishedAt 時間戳自己算出，
 * 不採信客戶端自己回報的數字——否則玩家只要竄改前端請求就能偽造任意成績上榜。
 * 客戶端畫面上顯示的碼表，只是給玩家看的即時體驗，不是最終判定成績的依據。
 *
 * 碼表只計「真正在播放音樂」的時間：每答對一題（非最後一題）都會有一段固定
 * SPEEDRUN_TRANSITION_SEC 秒的緩衝畫面，這段期間音樂是停止的，不該算進成績。
 * 扣除的量是「(題目數 - 1) × 緩衝秒數」這個固定值，不是採信客戶端回報的任何時間戳——
 * 緩衝畫面的長度完全由這裡的常數決定，不是客戶端可以自己操縱影響的東西，所以直接用
 * 固定公式扣除，不會有辦法透過偽造請求佔到便宜（少扣或多扣都對自己的成績沒有幫助）。
 */
interface SpeedrunSession {
  /** 這場挑戰的 10 首歌，依出題順序排列；songIds[i] 是第 i 題（0-based）的正確答案 */
  songIds: string[];
  /** 建立 session 當下的伺服器時間戳（毫秒），碼表從這一刻起算 */
  startedAt: number;
  /** 玩家已經答對到第幾題（下一題應該回答第 currentIndex 題）；等於 songIds.length 代表全部答對完成 */
  currentIndex: number;
  /** 答對最後一題的那一刻的時間戳；還沒完成挑戰時為 null */
  finishedAt: number | null;
}

const sessions = new Map<string, SpeedrunSession>();

// 挑戰開始後這麼久還沒完成，就視為玩家中途放棄了，清掉避免記憶體隨著時間一直累積
// （伺服器沒有重啟過、又一直有人開新挑戰卻沒玩完的極端情況）。
const SESSION_TTL_MS = 30 * 60 * 1000;

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.startedAt > SESSION_TTL_MS) sessions.delete(token);
  }
}

/**
 * 把「起訖時間戳的原始差值」換算成「扣掉緩衝畫面時間後」的實際計分秒數。
 * questionCount 題目共有 questionCount - 1 個題目間的緩衝畫面（最後一題答對後直接結算，
 * 沒有下一個緩衝畫面），每個緩衝固定 SPEEDRUN_TRANSITION_SEC 秒。
 */
function toScoredMs(rawMs: number, questionCount: number): number {
  const transitionCount = Math.max(0, questionCount - 1);
  const deducted = rawMs - transitionCount * SPEEDRUN_TRANSITION_SEC * 1000;
  return Math.max(0, deducted);
}

/** 開始一場新的挑戰，回傳供客戶端後續請求使用的 token */
export function createSpeedrunSession(songIds: string[]): { token: string } {
  cleanupExpiredSessions();
  const token = randomUUID();
  sessions.set(token, { songIds, startedAt: Date.now(), currentIndex: 0, finishedAt: null });
  return { token };
}

/**
 * 判定第 questionIndex 題選的 songId 對不對，答對就推進進度。
 *
 * 回傳 null 代表 token 無效（挑戰不存在或已逾時），或 questionIndex 不是「目前應該回答的
 * 那一題」（例如重複送出同一題、或跳題送出，順序防呆，避免用亂送請求的方式繞過正常流程）。
 */
export function checkSpeedrunAnswer(
  token: string,
  questionIndex: number,
  songId: string
): { correct: boolean; finished: boolean; totalTimeMs: number | null } | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (questionIndex !== session.currentIndex) return null;

  const correct = session.songIds[questionIndex] === songId;
  if (!correct) {
    return { correct: false, finished: false, totalTimeMs: null };
  }

  session.currentIndex += 1;
  const finished = session.currentIndex >= session.songIds.length;
  if (finished && session.finishedAt === null) {
    session.finishedAt = Date.now();
  }
  return {
    correct: true,
    finished,
    totalTimeMs: finished ? toScoredMs(session.finishedAt! - session.startedAt, session.songIds.length) : null,
  };
}

/**
 * 挑戰全部完成後交出最終成績，同時把這個 session 從記憶體移除（一次性使用，
 * 避免同一場挑戰被重複送出成績上榜）。回傳 null 代表 token 無效或挑戰根本還沒完成。
 */
export function finalizeSpeedrunSession(token: string): { totalTimeMs: number } | null {
  const session = sessions.get(token);
  if (!session || session.finishedAt === null) return null;
  const totalTimeMs = toScoredMs(session.finishedAt - session.startedAt, session.songIds.length);
  sessions.delete(token);
  return { totalTimeMs };
}
