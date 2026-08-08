'use client';

import { useEffect, useState } from 'react';
import { GameEngine, GameEngineState } from '../../lib/engine/gameEngine';

export function useGameEngine() {
  const [engine] = useState(() => new GameEngine());
  const [state, setState] = useState<GameEngineState>(() => engine.getState());

  useEffect(() => {
    const unsubscribe = engine.subscribe(setState);
    return () => {
      unsubscribe();
      engine.reset();
    };
  }, [engine]);

  return { engine, state };
}
