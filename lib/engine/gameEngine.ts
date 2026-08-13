import type { Song } from '../types/song';
import type { GameMode } from '../types/match';
import type { QuestionPayload } from '../types/question';
import { getModeStrategy } from './modes';

export const DEFAULT_ROUND_COUNT = 5;

// 單機無人別模式使用此 key 作為 scores 對照表的唯一鍵值
export const SOLO_PLAYER_KEY = '_solo';

export type GameStatus = 'idle' | 'question' | 'reveal' | 'finished';

export interface RoundResult {
  songId: string;
  question: QuestionPayload;
  roundIndex: number;
}

export interface GameEngineState {
  status: GameStatus;
  mode: GameMode | null;
  songPool: Song[];
  /** 題庫是否為「玩完篩選出來的全部歌曲」（未指定固定題數）；true 時 UI 不該顯示總題數，只顯示目前第幾題 */
  unlimitedRounds: boolean;
  roundCount: number;
  currentRoundIndex: number;
  currentQuestion: QuestionPayload | null;
  /** 對戰人別 id 清單；空陣列代表單機無人別模式，此時以 SOLO_PLAYER_KEY 記分 */
  players: string[];
  /** playerId -> 累計分數；單機模式鍵值固定為 SOLO_PLAYER_KEY。加分與換題是兩個獨立動作，互不影響。 */
  scores: Record<string, number>;
  results: RoundResult[];
}

export interface StartConfig {
  mode: GameMode;
  songPool: Song[];
  /** 省略時代表「玩完整個 songPool」（不限題數） */
  roundCount?: number;
  /** 未提供或空陣列 = 單機無人別模式（相容舊有單人流程） */
  playerIds?: string[];
}

type Listener = (state: GameEngineState) => void;

function createInitialState(): GameEngineState {
  return {
    status: 'idle',
    mode: null,
    songPool: [],
    unlimitedRounds: false,
    roundCount: 0,
    currentRoundIndex: -1,
    currentQuestion: null,
    players: [],
    scores: {},
    results: [],
  };
}

/**
 * 依題數需求從歌曲池抽題，避免同一首歌重複出現（若題庫足夠）。
 * roundCount 省略時代表把整個 songPool 都抽出來（不限題數，玩完為止）。
 * 邊界條件：songPool 為空時回傳空陣列，呼叫端須另行處理「無可用題目」狀態
 */
function drawSongsForRounds(songPool: Song[], roundCount?: number): Song[] {
  if (songPool.length === 0) return [];
  const shuffled = [...songPool].sort(() => Math.random() - 0.5);
  if (roundCount === undefined) return shuffled;
  return shuffled.slice(0, Math.min(roundCount, shuffled.length));
}

/**
 * 玩法：播放片段 → 玩家口頭搶答 → 主持人按「顯示正確答案」→ 按「下一題」繼續。
 * App 本身不判斷文字對錯、也不強制要求「揭曉答案」與「加分」綁在一起：
 * 加分（awardPoint）是隨時可以觸發的獨立動作（例如點擊玩家分數 +1），
 * 換題（nextQuestion）也是獨立動作，兩者互不依賴，UI 不需要在揭曉答案後強制先選出誰答對才能繼續。
 */
export class GameEngine {
  private state: GameEngineState = createInitialState();
  private listeners: Set<Listener> = new Set();
  private drawnSongs: Song[] = [];

  getState(): GameEngineState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<GameEngineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  start(config: StartConfig): void {
    this.drawnSongs = drawSongsForRounds(config.songPool, config.roundCount);
    const players = config.playerIds ?? [];
    const initialScores: Record<string, number> = {};
    (players.length > 0 ? players : [SOLO_PLAYER_KEY]).forEach((id) => {
      initialScores[id] = 0;
    });

    this.setState({
      status: this.drawnSongs.length > 0 ? 'question' : 'finished',
      mode: config.mode,
      songPool: config.songPool,
      unlimitedRounds: config.roundCount === undefined,
      roundCount: this.drawnSongs.length,
      currentRoundIndex: this.drawnSongs.length > 0 ? 0 : -1,
      currentQuestion: this.drawnSongs.length > 0 ? this.prepareQuestion(config.mode, this.drawnSongs[0]) : null,
      players,
      scores: initialScores,
      results: [],
    });
  }

  private prepareQuestion(mode: GameMode, song: Song): QuestionPayload {
    return getModeStrategy(mode).prepareQuestion(song);
  }

  /** 顯示這題的正確答案，不涉及任何判分 */
  revealAnswer(): void {
    if (this.state.status !== 'question') return;
    this.setState({ status: 'reveal' });
  }

  /**
   * 幫指定玩家（或單機模式的 SOLO_PLAYER_KEY）調整分數（delta 為 +1 或 -1）。
   * 只能在已公布答案（reveal）狀態下觸發，避免答案還沒公布就先加分；
   * 分數下限為 0，不會因為誤按減到負數。
   */
  awardPoint(playerId: string, delta: 1 | -1 = 1): void {
    if (this.state.status !== 'reveal') return;
    const scores = { ...this.state.scores };
    scores[playerId] = Math.max(0, (scores[playerId] ?? 0) + delta);
    this.setState({ scores });
  }

  /** 換到下一題（或若已是最後一題則結束比賽），只能在已顯示答案（reveal）狀態下觸發 */
  nextQuestion(): void {
    if (this.state.status !== 'reveal' || !this.state.currentQuestion) return;

    const result: RoundResult = {
      songId: this.state.currentQuestion.songId,
      question: this.state.currentQuestion,
      roundIndex: this.state.currentRoundIndex,
    };
    this.setState({ results: [...this.state.results, result] });

    this.advanceRound();
  }

  private advanceRound(): void {
    if (!this.state.mode) return;
    const nextIndex = this.state.currentRoundIndex + 1;

    if (nextIndex >= this.drawnSongs.length) {
      this.setState({ status: 'finished', currentQuestion: null });
      return;
    }

    const song = this.drawnSongs[nextIndex];
    this.setState({
      status: 'question',
      currentRoundIndex: nextIndex,
      currentQuestion: this.prepareQuestion(this.state.mode, song),
    });
  }

  /** 玩家主動提前結束這場比賽，不用把題庫剩下的歌全部玩完 */
  endMatchEarly(): void {
    if (this.state.status === 'idle' || this.state.status === 'finished') return;
    this.setState({ status: 'finished', currentQuestion: null });
  }

  reset(): void {
    this.drawnSongs = [];
    this.state = createInitialState();
    this.listeners.forEach((l) => l(this.state));
  }
}
