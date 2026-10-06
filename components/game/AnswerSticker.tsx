'use client';

import { useCallback, useState } from 'react';

/** YouTube 縮圖網址（4:3、上下各帶黑邊的 hqdefault，黑邊由 .stage-cover 的縮放裁掉）。 */
export function youtubeCoverUrl(videoId: string | null | undefined): string | null {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

interface AnswerStickerProps {
  title: string;
  artist?: string | null;
  coverUrl?: string | null;
}

/**
 * 公布答案時的唱片貼紙：歌曲封面印滿整張貼紙（圓形裁切），底部壓一層漸層讓歌名歌手可讀，
 * 正中央留一個唱片中軸孔。封面載入完成前、或沒有封面時，維持原本的金色貼紙＋深色字，
 * 載入完成才淡入封面，不會出現破圖或版面跳動。
 */
export function AnswerSticker({ title, artist, coverUrl }: AnswerStickerProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const showCover = Boolean(coverUrl) && !failed;
  // 圖片在 React 掛上 onLoad 之前就載入完成（快取、SSR 輸出）時不會再觸發 load 事件，
  // 所以掛載時要主動檢查 complete。
  const imgRef = useCallback((el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, []);

  return (
    <div className={`stage-sticker is-answer${showCover && loaded ? ' has-cover' : ''}`} role="status">
      {showCover && (
        // eslint-disable-next-line @next/next/no-img-element -- 外部 YouTube 縮圖，不經 Next 圖片最佳化
        <img
          key={coverUrl}
          ref={imgRef}
          src={coverUrl!}
          alt=""
          className={`stage-cover${loaded ? ' is-loaded' : ''}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {showCover && loaded && <span className="stage-cover-scrim" aria-hidden="true" />}
      {showCover && loaded && <span className="stage-spindle" aria-hidden="true" />}
      <span className="stage-answer-title">{title}</span>
      {artist && <span className="stage-answer-artist">{artist}</span>}
    </div>
  );
}
