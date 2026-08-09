import { Suspense } from 'react';
import { GamePage } from '../../../components/game/GamePage';

export default function RandomClipPage() {
  return (
    <Suspense>
      <GamePage mode="RANDOM_CLIP" title="隨機片段猜歌" />
    </Suspense>
  );
}
