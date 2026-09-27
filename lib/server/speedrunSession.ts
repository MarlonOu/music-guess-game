import { randomUUID } from 'node:crypto';
import { SPEEDRUN_TRANSITION_SEC, SPEEDRUN_AUDIO_WAIT_CAP_MS } from '../constants/speedrun';

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
 * 碼表只計「真正在播放音樂」的時間，扣除兩種「沒有真正在播放」的區間：
 * 1. 緩衝畫面：每答對一題（非最後一題）都有一段固定 SPEEDRUN_TRANSITION_SEC 秒的緩衝畫面，
 *    這段期間音樂是停止的。扣除量是「(題目數 - 1) × 緩衝秒數」這個固定值，不是採信客戶端
 *    回報的任何時間戳——緩衝畫面的長度完全由程式碼裡的常數決定，不是客戶端能操縱的東西，
 *    所以直接用固定公式扣除，沒有被濫用的空間。
 * 2. 音訊緩衝／網路等待：裝置網路不好時，從「這一題開始」到「音樂真的開始播放」中間可能會
 *    有一段空檔，這段時間玩家根本聽不到音樂，理論上也不該算進成績。這段就沒辦法用固定公式
 *    算了（每個人網路狀況不一樣），只能靠客戶端回報「音樂真的開始播放了」（見
 *    reportAudioStarted）。這裡刻意跟緩衝畫面的扣除方式不同、多做兩件事以防被濫用：
 *    (a) 每題扣除的量設一個上限（SPEEDRUN_AUDIO_WAIT_CAP_MS），即使有人刻意慢一點才回報
 *        「音樂開始了」想多扣一點時間，每題最多也只能佔到這麼多便宜，10 題累積下來的影響
 *        有限，不會變成可以隨意灌水的大洞；
 *    (b) 每一題只採信第一次回報，同一題重複回報不會重複扣除。
 *    這是刻意接受的取捨：完全不能保證杜絕濫用（客戶端回報的時間點終究是客戶端說了算），
 *    但這是個朋友間同樂用的排行榜，不是正式競賽，用「設上限」換取「網路不好的人成績更公平」
 *    是合理的權衡。
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
  /** 目前這一題「開始等待音樂播放」的時間戳（見 reportAudioStarted 的說明） */
  currentQuestionStartedAt: number;
  /** 目前這一題是不是已經回報過「音樂開始播放了」，避免同一題重複回報、重複扣除 */
  audioWaitReportedForIndex: number | null;
  /** 累積目前為止所有題目的「等待音樂播放」扣除量（每題已經套用過上限） */
  totalAudioWaitMs: number;
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
 * 把「起訖時間戳的原始差值」換算成「扣掉緩衝畫面與音訊等待時間後」的實際計分毫秒數。
 * questionCount 題目共有 questionCount - 1 個題目間的緩衝畫面（最後一題答對後直接結算，
 * 沒有下一個緩衝畫面），每個緩衝固定 SPEEDRUN_TRANSITION_SEC 秒。
 */
function toScoredMs(rawMs: number, questionCount: number, totalAudioWaitMs: number): number {
  const transitionCount = Math.max(0, questionCount - 1);
  const deducted = rawMs - transitionCount * SPEEDRUN_TRANSITION_SEC * 1000 - totalAudioWaitMs;
  return Math.max(0, deducted);
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
    currentQuestionStartedAt: now,
    audioWaitReportedForIndex: null,
    totalAudioWaitMs: 0,
  });
  return { token };
}

/**
 * 客戶端偵測到「目前這一題的音樂真的開始播放了」時呼叫，用來扣除網路不好、音訊緩衝
 * 拖延到的等待時間（見上方型別定義的說明）。questionIndex 必須跟目前伺服器記錄的
 * currentIndex 一致，才會採信——避免用過期或超前的題號回報造成計算錯亂。
 * 同一題只有第一次回報會生效，之後重複回報（例如網路重試）會被忽略，不會重複扣除。
 */
export function reportAudioStarted(token: string, questionIndex: number): void {
  const session = sessions.get(token);
  if (!session) return;
  if (questionIndex !== session.currentIndex) return;
  if (session.audioWaitReportedForIndex === questionIndex) return;

  const waitMs = Date.now() - session.currentQuestionStartedAt;
  const cappedWaitMs = Math.max(0, Math.min(waitMs, SPEEDRUN_AUDIO_WAIT_CAP_MS));
  session.totalAudioWaitMs += cappedWaitMs;
  session.audioWaitReportedForIndex = questionIndex;
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
  } else if (!finished) {
    // 換到下一題了，重置「這一題開始等待音樂播放」的時間戳跟回報狀態，
    // 讓 reportAudioStarted 能正確採信下一題的回報。
    //
    // 這裡故意不是單純的 Date.now()，而是加上 SPEEDRUN_TRANSITION_SEC 的偏移——
    // 這是修正一個實際發生過的重複扣除 bug：客戶端答對之後不會立刻去載入下一題的音樂，
    // 而是要先跑完 SPEEDRUN_TRANSITION_SEC 秒的緩衝畫面倒數，才會真正呼叫 play()。
    // 如果這裡直接用 Date.now()（也就是答對的那一刻）當作「開始等待播放」的起點，
    // 之後 reportAudioStarted 算出來的等待時間，會把整段緩衝畫面倒數的時間也算進去——
    // 但緩衝畫面的時間已經在 toScoredMs() 用固定公式扣過一次了，等於同一段時間被扣了兩次，
    // 10 題裡有 9 題都會重複扣，累加起來足以把大半的實際遊玩時間都吃掉，成績算得遠比
    // 玩家實際花費的時間短很多。加上這個偏移之後，「開始等待播放」的起點會落在「緩衝畫面
    // 倒數結束、客戶端實際開始嘗試載入下一題音樂」的那個時間點附近，兩種扣除才不會重疊。
    session.currentQuestionStartedAt = Date.now() + SPEEDRUN_TRANSITION_SEC * 1000;
    session.audioWaitReportedForIndex = null;
  }
  return {
    correct: true,
    finished,
    totalTimeMs: finished
      ? toScoredMs(session.finishedAt! - session.startedAt, session.songIds.length, session.totalAudioWaitMs)
      : null,
  };
}

/**
 * 挑戰全部完成後交出最終成績，同時把這個 session 從記憶體移除（一次性使用，
 * 避免同一場挑戰被重複送出成績上榜）。回傳 null 代表 token 無效或挑戰根本還沒完成。
 */
export function finalizeSpeedrunSession(token: string): { totalTimeMs: number } | null {
  const session = sessions.get(token);
  if (!session || session.finishedAt === null) return null;
  const totalTimeMs = toScoredMs(session.finishedAt - session.startedAt, session.songIds.length, session.totalAudioWaitMs);
  sessions.delete(token);
  return { totalTimeMs };
}
