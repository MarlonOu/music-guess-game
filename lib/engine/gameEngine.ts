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
  /** 該題答對／得分的玩家 id；null 代表這題沒人答對（略過不計分） */
  winnerPlayerId: string | null;
  roundIndex: number;
}

export interface GameEngineState {
  status: GameStatus;
  mode: GameMode | null;
  songPool: Song[];
  roundCount: number;
  currentRoundIndex: number;
  currentQuestion: QuestionPayload | null;
  /** 對戰人別 id 清單；空陣列代表單機無人別模式，此時以 SOLO_PLAYER_KEY 記分 */
  players: string[];
  /** playerId -> 累計分數；單機模式鍵值固定為 SOLO_PLAYER_KEY */
  scores: Record<string, number>;
  results: RoundResult[];
}

export interface StartConfig {
  mode: GameMode;
  songPool: Song[];
  roundCount: number;
  /** 未提供或空陣列 = 單機無人別模式（相容舊有單人流程） */
  playerIds?: string[];
}

type Listener = (state: GameEngineState) => void;

function createInitialState(): GameEngineState {
  return {
    status: 'idle',
    mode: null,
    songPool: [],
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
 * 輸入：songPool、roundCount
 * 輸出：長度為 min(roundCount, songPool.length) 的 Song 陣列，隨機排序
 * 邊界條件：songPool 為空時回傳空陣列，呼叫端須另行處理「無可用題目」狀態
 */
function drawSongsForRounds(songPool: Song[], roundCount: number): Song[] {
  if (songPool.length === 0) return [];
  const shuffled = [...songPool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(roundCount, shuffled.length));
}

/**
 * 玩法：播放片段 → 玩家口頭搶答 → 主持人按「顯示正確答案」→ 手動點選這題是誰答對（或沒人答對）。
 * App 本身不判斷文字對錯，只負責播放、揭曉答案、記錄計分，判定交由玩家彼此口頭確認。
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
   * 記錄這題是誰答對（playerId 為 null 代表沒人答對，不計分），
   * 記錄完立即進入下一題（或若已是最後一題則結束比賽）。
   */
  awardPoint(playerId: string | null): void {
    if (this.state.status !== 'reveal' || !this.state.currentQuestion) return;

    const scores = { ...this.state.scores };
    if (playerId) {
      scores[playerId] = (scores[playerId] ?? 0) + 1;
    }

    const result: RoundResult = {
      songId: this.state.currentQuestion.songId,
      question: this.state.currentQuestion,
      winnerPlayerId: playerId,
      roundIndex: this.state.currentRoundIndex,
    };

    this.setState({ scores, results: [...this.state.results, result] });
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

  reset(): void {
    this.drawnSongs = [];
    this.state = createInitialState();
    this.listeners.forEach((l) => l(this.state));
  }
}
