import type { GameMode } from './match';
import type { QuestionPayload } from './question';

export type RoomStatus = 'lobby' | 'playing' | 'finished';
/** 搶答方式：'text' 打字搶答（在聊天室輸入歌名，既有預設行為）；'choice' 選擇題搶答（見 lib/server/choiceMode.ts） */
export type AnswerMode = 'text' | 'choice';

export interface RoomChoice {
  songId: string;
  title: string;
}

export interface RoomPlayer {
  id: string;
  displayName: string;
  score: number;
}

export interface RoomMessage {
  id: string;
  playerId: string;
  displayName: string;
  text: string;
  isCorrectAnswer: boolean;
  roundIndex: number | null;
  createdAt: string;
}

export interface RoomState {
  id: string;
  joinCode: string;
  mode: GameMode;
  answerMode: AnswerMode;
  artistFilterIds: string[];
  themeFilterIds: string[];
  status: RoomStatus;
  roundCount: number;
  currentRoundIndex: number;
  /**
   * 目前這題的題目內容；revealed 為 false 時 correctTitle 會被伺服器端遮蔽為空字串，
   * 避免透過輪詢 API 提前偷看到答案。status 為 'lobby' 或 'finished' 時為 null。
   */
  currentQuestion: QuestionPayload | null;
  /**
   * answerMode='choice' 時，這一輪要顯示的選項清單（含正確答案，順序已經洗牌過）。
   * 這個清單本身不需要依 revealed 遮蔽——選擇題本來就要把所有選項攤在眼前給玩家選，
   * 遮蔽的是「哪一個才是正確答案」這件事，不是選項本身。answerMode='text' 或非
   * 'playing' 狀態時為空陣列。
   */
  currentChoices: RoomChoice[];
  /**
   * 目前這題要播放的音源。source 決定要用 AudioController 的哪一條播放路徑；
   * playbackId 依 source 不同意義不同（'youtube' 時是影片 id，'apple' 時是試聽片段網址）。
   * 挑選邏輯（哪個來源優先）見 lib/audio/resolvePlaybackTarget.ts。
   * 與 currentQuestion 分開存放（QuestionPayload 為本機/線上共用型別，不含播放來源）。
   * null 代表沒有可播放的音源（不應該發生，後台表單與匯入都要求至少一種來源存在，
   * 純粹防呆；也可能是 currentQuestion 本身是純文字歌詞題，不需要播放音訊）。
   */
  currentSongSource: 'youtube' | 'apple' | 'deezer' | null;
  currentSongPlaybackId: string | null;
  /**
   * 目前這題答案歌手名稱；跟 currentQuestion.correctTitle 一樣，revealed 為 false 時會被伺服器端遮蔽為 null，
   * 避免透過輪詢 API 提前偷看到答案。
   */
  currentSongArtist: string | null;
  /**
   * 這首歌「符合本場房間主題篩選」的主題名稱清單（僅在房間有套用主題篩選時才會有內容）。
   * revealed 為 false 時同樣遮蔽為空陣列。
   */
  currentSongThemeLabels: string[];
  revealed: boolean;
  /** 目前這題已投票「跳過」的玩家 id 清單，換題時重置為空陣列 */
  skipVotePlayerIds: string[];
  /**
   * 上一題被公布時的答案快照（答對或全員投票流局的當下存的），供客戶端在「這題結束、
   * 下一題正式開始前」這段過渡期間顯示用——因為答對/流局的當下伺服器已經立刻把
   * currentRoundIndex 推進到下一題（見 lib/server/advanceRound.ts），currentQuestion
   * 這時已經指向新的一題，要顯示「剛剛那題的答案」就得看這幾個欄位而不是 currentQuestion。
   * lastRevealedAt 是絕對時間戳，客戶端依「現在距離 lastRevealedAt 多久」判斷是否還在
   * 顯示答案的過渡期間（REVEAL_DISPLAY_SEC 秒內），不依賴任何本地計時器。
   */
  lastRevealedTitle: string | null;
  lastRevealedArtist: string | null;
  lastRevealedThemeLabels: string[];
  lastRevealedAt: string | null;
  /** 目前這題開始播放的時間戳（ISO 字串），供各玩家端計算該從第幾秒接著播放做同步近似 */
  roundStartedAt: string | null;
  hostPlayerId: string;
  players: RoomPlayer[];
}
