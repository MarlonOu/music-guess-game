import type { GameMode } from '../../types/match';
import type { GameModeStrategy } from '../../types/question';
import { introMode } from './introMode';
import { randomClipMode } from './randomClipMode';
import { lyricLineMode } from './lyricLineMode';

// 新增模式時，僅需在此註冊，不得修改既有模式檔案
export const gameModeRegistry: Record<GameMode, GameModeStrategy> = {
  INTRO: introMode,
  RANDOM_CLIP: randomClipMode,
  LYRIC_LINE: lyricLineMode,
};

export function getModeStrategy(mode: GameMode): GameModeStrategy {
  return gameModeRegistry[mode];
}
