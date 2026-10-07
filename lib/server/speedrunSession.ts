import { randomUUID } from 'node:crypto';
import {
  SPEEDRUN_TRANSITION_SEC,
  SPEEDRUN_AUDIO_WAIT_CAP_MS,
  SPEEDRUN_MIN_QUESTION_MS,
  SPEEDRUN_LOCKOUT_TOLERANCE_MS,
} from '../constants/speedrun';
import { WRONG_ANSWER_LOCKOUT_MS } from '../constants/choiceMode';

/**
 * 速通模式（單機、隨機片段猜歌＋選擇題搶答，10 題計時）進行中的挑戰狀態。
 *
 * 刻意存在伺服器記憶體，不寫資料庫：這是單人挑戰，不是像線上模式那樣需要多裝置同步的
 * 房間狀態，也不需要跨伺服器重啟存活（重啟時剛好在挑戰中的人，重新整理頁面重新開始即可，
 * 影響範圍很小）。只有「挑戰完成、成績確定下來」的那一刻，才真正寫進 SpeedrunScore 資料表
 * （見 app/api/speedrun/submit/route.ts）。
 *
 * 核心設計：完成時間（totalTimeMs）由伺服器依各題「送出／答對」的時間戳自己算出（單題計分耗時，
 * 見 checkSpeedrunAnswer），
 * 不採信客戶端自己回報的「完成時間」——否則玩家只要竄改前端請求就能偽造任意成績上榜。
 * 客戶端畫面上顯示的碼表，只是給玩家看的即時體驗，不是最終判定成績的依據。
 *
 * 碼表只計「真正在播放音樂」的時間，扣除「沒有真正在播放」的區間：換題時的緩衝畫面
 * （答對後、下一題正式開始前的讀秒動畫，這段期間音樂是停止的）、加上音訊緩衝／網路等待
 * （裝置網路不好時，從「這一題開始」到「音樂真的開始播放」中間可能會有一段空檔，這段時間
 * 玩家根本聽不到音樂），這兩段對玩家來說是連續發生、感受不到分界的同一段「死時間」，
 * 所以乾脆合併成一段一起量測、一起扣除，不再分開處理。
 *
 * 這裡採用「客戶端回報自己量測到的死時間毫秒數，伺服器只負責封頂」的設計（見
 * reportAudioWait），不是用固定公式或伺服器自己假設的起算時間點去推算。這是修正兩個
 * 實際發生過的問題：
 * (1) 如果緩衝畫面的扣除量是伺服器端用「(題目數-1) × 固定秒數」這種公式硬算，沒有考慮到
 *     setTimeout 本身的時序不會剛好精準命中這個秒數（瀏覽器排程、React 重新渲染等開銷都會
 *     讓實際耗費的時間比理論值多一點點），這個誤差雖然每次都很小，累積 9 次換題後會變成
 *     看得出來的落差（成績比玩家實際體驗到的快了將近一秒）。
 * (2) 如果伺服器改用「答對的那一刻 + 假設的固定秒數」當作下一題等待播放的起算時間點，
 *     一樣建立在「客戶端的緩衝畫面剛好精準命中這個秒數」的假設上，會有跟 (1) 一樣的問題。
 * 改成讓客戶端直接回報「我自己量到這段死時間總共多久」，伺服器不用再猜測、也不用維護
 * 一個容易跟客戶端實際行為對不上的假設，兩邊自然就會一致——客戶端本來就有最準確的
 * 第一手量測，要伺服器憑空重建這個數字才是本末倒置。
 *
 * 這樣「相信客戶端回報的數字」會不會被濫用？套用防線：
 * (a) 每題扣除的量設一個上限（見 reportAudioWait，換題後的題目上限比第一題更寬，因為
 *     多含了一段緩衝畫面），就算有人回報一個誇大的數字，每題最多也只能佔到這麼多便宜，
 *     10 題累積下來的影響有限，不會變成可以隨意灌水的大洞；
 * (b) 每一題只採信第一次回報，同一題重複回報不會重複扣除。
 * 這是刻意接受的取捨：完全不能保證杜絕濫用（客戶端回報的數字終究是客戶端說了算），
 * 但這是個朋友間同樂用的排行榜，不是正式競賽，用「設上限」換取「數字精準對得起來」
 * 是合理的權衡。
 */
interface SpeedrunSession {
  /** 這場挑戰的 10 首歌，依出題順序排列；songIds[i] 是第 i 題（0-based）的正確答案 */
  songIds: string[];
  /** 建立 session 當下的伺服器時間戳（毫秒），只用來判斷逾時清除 */
  startedAt: number;
  /** 玩家已經答對到第幾題（下一題應該回答第 currentIndex 題）；等於 songIds.length 代表全部答對完成 */
  currentIndex: number;
  /** 答對最後一題的那一刻的時間戳；還沒完成挑戰時為 null */
  finishedAt: number | null;
  /** 目前這一題是不是已經回報過「等了多久」，避免同一題重複回報、重複扣除 */
  audioWaitReportedForIndex: number | null;
  /** 目前這一題被伺服器送出（上一題答對、或挑戰開始）的時間戳，單題耗時由此起算 */
  questionServedAt: number;
  /** 目前這一題客戶端回報的等待毫秒數（已套用上限），答對時才會結算扣除 */
  currentWaitMs: number;
  /** 已答對各題的計分耗時加總（每題都已扣掉等待時間、並套用單題下限） */
  scoredMs: number;
  /** 目前這一題最近一次答錯的時間戳；null 代表這題還沒答錯過。用來在伺服器端強制答錯鎖定。 */
  lastWrongAt: number | null;
  /**
   * 挑戰完成的那一刻，就把最終成績算好、凍結存在這裡；finalizeSpeedrunSession() 之後
   * 只讀取這個凍結的數字，不會重新計算一次，確保玩家看到的成績與送出上榜的成績一致。
   */
  finalScoreMs: number | null;
}

// 以 globalThis 保存，避免各 route bundle 各自持有一份獨立的 Map 導致 start／check 對不上。
const globalForSessions = globalThis as unknown as { __speedrunSessions?: Map<string, SpeedrunSession> };
const sessions = (globalForSessions.__speedrunSessions ??= new Map<string, SpeedrunSession>());

// 挑戰開始後這麼久還沒完成，就視為玩家中途放棄了，清掉避免記憶體隨著時間一直累積
// （伺服器沒有重啟過、又一直有人開新挑戰卻沒玩完的極端情況）。
const SESSION_TTL_MS = 30 * 60 * 1000;

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.startedAt > SESSION_TTL_MS) sessions.delete(token);
  }
}

/** 開始一場新的挑戰，回傳供客戶端後續請求使用的 token */
export function createSpeedrunSession(songIds: string[]): { token: string } {
  cleanupExpiredSessions();
  const token = randomUUID();
  const now = Date.now();
  sessions.set(token, {
    songIds,
    startedAt: now,
    currentIndex: 0,
    finishedAt: null,
    audioWaitReportedForIndex: null,
    questionServedAt: now,
    currentWaitMs: 0,
    scoredMs: 0,
    lastWrongAt: null,
    finalScoreMs: null,
  });
  return { token };
}

/**
 * 客戶端回報「目前這一題，從（緩衝畫面開始，如果有的話）到音樂真的開始播放（或明確判定
 * 放不出來），總共量到多久」，用來扣除緩衝畫面與網路不好、音訊緩衝拖延到的等待時間
 * （見上方型別定義的說明，包含為什麼改成客戶端回報量測值、以及防濫用的上限機制）。
 * questionIndex 必須跟目前伺服器記錄的 currentIndex 一致，才會採信——避免用過期或超前的
 * 題號回報造成計算錯亂。同一題只有第一次回報會生效，之後重複回報（例如網路重試）會被
 * 忽略，不會重複扣除。waitMs 不是正常數字（負數、NaN 等）一律當成 0 處理，不會讓資料異常。
 *
 * 上限依「這一題前面有沒有緩衝畫面」而不同：第 0 題（一開始就是這題，前面沒有緩衝畫面）
 * 上限就是 SPEEDRUN_AUDIO_WAIT_CAP_MS；其餘題目前面都有一段固定 SPEEDRUN_TRANSITION_SEC
 * 秒的緩衝畫面，這段時間本來就該完整算進「死時間」，所以上限要多加這個秒數，
 * 不然緩衝畫面本身正常花費的時間都會被誤判成「超過上限、只能扣一部分」。
 */
export function reportAudioWait(token: string, questionIndex: number, waitMs: number): void {
  const session = sessions.get(token);
  if (!session) return;
  if (questionIndex !== session.currentIndex) return;
  if (session.audioWaitReportedForIndex === questionIndex) return;

  const capMs = questionIndex === 0 ? SPEEDRUN_AUDIO_WAIT_CAP_MS : SPEEDRUN_TRANSITION_SEC * 1000 + SPEEDRUN_AUDIO_WAIT_CAP_MS;
  const safeWaitMs = Number.isFinite(waitMs) ? waitMs : 0;
  const cappedWaitMs = Math.max(0, Math.min(safeWaitMs, capMs));
  session.currentWaitMs = cappedWaitMs;
  session.audioWaitReportedForIndex = questionIndex;
}

export type SpeedrunCheckResult =
  | { correct: boolean; finished: boolean; totalTimeMs: number | null; locked?: false }
  | { correct: false; finished: false; totalTimeMs: null; locked: true; retryAfterMs: number };

/**
 * 判定第 questionIndex 題選的 songId 對不對，答對就推進進度。
 *
 * 回傳 null 代表 token 無效（挑戰不存在或已逾時），或 questionIndex 不是「目前應該回答的
 * 那一題」（例如重複送出同一題、或跳題送出，順序防呆，避免用亂送請求的方式繞過正常流程）。
 *
 * 防作弊重點：
 * (1) 答錯鎖定由伺服器強制執行：答錯後在鎖定時間內再送出的請求一律回傳 locked，不做判定。
 *     原本鎖定只存在前端，腳本可以無視鎖定在幾十毫秒內把四個選項全部試過一輪。
 * (2) 計分以「單題」為單位結算：單題耗時 = 這題被送出到答對的伺服器時間差，扣掉客戶端回報的
 *     等待時間（上限且不得超過該題實際經過時間），再套用單題下限 SPEEDRUN_MIN_QUESTION_MS。
 *     沒有下限的話，回報誇大的等待時間就能把成績扣到 0。
 */
export function checkSpeedrunAnswer(token: string, questionIndex: number, songId: string): SpeedrunCheckResult | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (questionIndex !== session.currentIndex) return null;

  const now = Date.now();
  if (session.lastWrongAt !== null) {
    const lockMs = WRONG_ANSWER_LOCKOUT_MS - SPEEDRUN_LOCKOUT_TOLERANCE_MS;
    const sinceWrong = now - session.lastWrongAt;
    if (sinceWrong < lockMs) {
      return { correct: false, finished: false, totalTimeMs: null, locked: true, retryAfterMs: lockMs - sinceWrong };
    }
  }

  const correct = session.songIds[questionIndex] === songId;
  if (!correct) {
    session.lastWrongAt = now;
    return { correct: false, finished: false, totalTimeMs: null };
  }

  const elapsed = Math.max(0, now - session.questionServedAt);
  // 等待時間最多只能扣到「這題實際經過的時間」，再套用單題下限。
  // 注意：扣除量不能先替下限預留空間（先前寫成 elapsed - 下限），那樣每一題只要答得快、
  // 緩衝畫面與音訊等待佔了大部分經過時間，就會被多算數百毫秒到一兩秒，累積起來結算成績
  // 就會比玩家在畫面上看到的碼表多出將近 2 秒。
  const effective = Math.max(SPEEDRUN_MIN_QUESTION_MS, elapsed - Math.min(session.currentWaitMs, elapsed));
  session.scoredMs += effective;

  session.currentIndex += 1;
  session.lastWrongAt = null;
  const finished = session.currentIndex >= session.songIds.length;
  if (finished && session.finishedAt === null) {
    session.finishedAt = now;
    // 在答對最後一題的這一刻就凍結最終成績，之後 finalizeSpeedrunSession() 只讀這個值。
    session.finalScoreMs = session.scoredMs;
  } else if (!finished) {
    // 換到下一題：重置這題的起算時間與等待回報狀態。
    session.questionServedAt = now;
    session.currentWaitMs = 0;
    session.audioWaitReportedForIndex = null;
  }
  return {
    correct: true,
    finished,
    totalTimeMs: finished ? session.finalScoreMs : null,
  };
}

/**
 * 挑戰全部完成後交出最終成績，同時把這個 session 從記憶體移除（一次性使用，
 * 避免同一場挑戰被重複送出成績上榜）。回傳 null 代表 token 無效或挑戰根本還沒完成。
 */
export function finalizeSpeedrunSession(token: string): { totalTimeMs: number } | null {
  const session = sessions.get(token);
  if (!session || session.finishedAt === null || session.finalScoreMs === null) return null;
  const totalTimeMs = session.finalScoreMs;
  sessions.delete(token);
  return { totalTimeMs };
}
