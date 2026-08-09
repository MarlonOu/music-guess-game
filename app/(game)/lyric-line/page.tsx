import { Suspense } from 'react';
import { GamePage } from '../../../components/game/GamePage';

export default function LyricLinePage() {
  return (
    <Suspense>
      <GamePage mode="LYRIC_LINE" title="歌詞猜歌" />
    </Suspense>
  );
}
