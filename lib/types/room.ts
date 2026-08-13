import type { GameMode } from './match';
import type { QuestionPayload } from './question';

export type RoomStatus = 'lobby' | 'playing' | 'finished';

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
  /** 目前這題要播放的 YouTube 影片 ID，與 currentQuestion 分開存放（QuestionPayload 為本機/線上共用型別，不含播放來源） */
  currentSongVideoId: string | null;
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
  /** 目前這題開始播放的時間戳（ISO 字串），供各玩家端計算該從第幾秒接著播放做同步近似 */
  roundStartedAt: string | null;
  hostPlayerId: string;
  players: RoomPlayer[];
}
