import type { Song } from '../types/song';
import type { GameMode } from '../types/match';
import type { QuestionPayload } from '../types/question';
import { getModeStrategy } from './modes';

export const DEFAULT_ROUND_TIME_SEC = 15;
export const DEFAULT_ROUND_COUNT = 5;

export type GameStatus = 'idle' | 'question' | 'reveal' | 'finished';

export interface RoundResult {
  songId: string;
  question: QuestionPayload;
  userAnswer: string;
  correct: boolean;
}

export interface GameEngineState {
  status: GameStatus;
  mode: GameMode | null;
  songPool: Song[];
  roundCount: number;
  currentRoundIndex: number;
  currentQuestion: QuestionPayload | null;
  timeRemainingSec: number;
  score: number;
  results: RoundResult[];
}

export interface StartConfig {
  mode: GameMode;
  songPool: Song[];
  roundCount: number;
  roundTimeSec?: number;
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
    timeRemainingSec: 0,
    score: 0,
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

export class GameEngine {
  private state: GameEngineState = createInitialState();
  private listeners: Set<Listener> = new Set();
  private roundTimeSec: number = DEFAULT_ROUND_TIME_SEC;
  private drawnSongs: Song[] = [];
  private timerHandle: ReturnType<typeof setInterval> | null = null;

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
    this.stopTimer();
    this.roundTimeSec = config.roundTimeSec ?? DEFAULT_ROUND_TIME_SEC;
    this.drawnSongs = drawSongsForRounds(config.songPool, config.roundCount);

    this.setState({
      status: this.drawnSongs.length > 0 ? 'question' : 'finished',
      mode: config.mode,
      songPool: config.songPool,
      roundCount: this.drawnSongs.length,
      currentRoundIndex: this.drawnSongs.length > 0 ? 0 : -1,
      currentQuestion: this.drawnSongs.length > 0 ? this.prepareQuestion(config.mode, this.drawnSongs[0]) : null,
      timeRemainingSec: this.roundTimeSec,
      score: 0,
      results: [],
    });

    if (this.drawnSongs.length > 0) {
      this.startTimer();
    }
  }

  private prepareQuestion(mode: GameMode, song: Song): QuestionPayload {
    return getModeStrategy(mode).prepareQuestion(song);
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerHandle = setInterval(() => {
      const next = this.state.timeRemainingSec - 1;
      if (next <= 0) {
        this.setState({ timeRemainingSec: 0 });
        this.revealAnswer('');
      } else {
        this.setState({ timeRemainingSec: next });
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  submitAnswer(userAnswer: string): void {
    if (this.state.status !== 'question') return;
    this.revealAnswer(userAnswer);
  }

  private revealAnswer(userAnswer: string): void {
    if (!this.state.mode || !this.state.currentQuestion) return;
    this.stopTimer();

    const strategy = getModeStrategy(this.state.mode);
    const correct = strategy.judgeAnswer(this.state.currentQuestion, userAnswer);
    const result: RoundResult = {
      songId: this.state.currentQuestion.songId,
      question: this.state.currentQuestion,
      userAnswer,
      correct,
    };

    this.setState({
      status: 'reveal',
      score: correct ? this.state.score + 1 : this.state.score,
      results: [...this.state.results, result],
    });
  }

  nextQuestion(): void {
    if (this.state.status !== 'reveal') return;
    const nextIndex = this.state.currentRoundIndex + 1;

    if (nextIndex >= this.drawnSongs.length) {
      this.setState({ status: 'finished', currentQuestion: null });
      return;
    }

    if (!this.state.mode) return;
    const song = this.drawnSongs[nextIndex];

    this.setState({
      status: 'question',
      currentRoundIndex: nextIndex,
      currentQuestion: this.prepareQuestion(this.state.mode, song),
      timeRemainingSec: this.roundTimeSec,
    });
    this.startTimer();
  }

  reset(): void {
    this.stopTimer();
    this.drawnSongs = [];
    this.state = createInitialState();
    this.listeners.forEach((l) => l(this.state));
  }
}
