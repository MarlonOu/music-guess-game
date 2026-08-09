import { Suspense } from 'react';
import { GamePage } from '../../../components/game/GamePage';

export default function IntroPage() {
  return (
    <Suspense>
      <GamePage mode="INTRO" title="前奏猜歌" />
    </Suspense>
  );
}
