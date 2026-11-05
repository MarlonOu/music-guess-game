'use client';

import { useLayoutEffect, useRef, useState } from 'react';

type Props = {
  /** 各段累計秒數，例如 [0.5, 1, 2, 4, 8, 12, 16] */
  stages: readonly number[];
  /** 目前解鎖到第幾段（0 起算） */
  stage: number;
  /** 是否正在播放（播放時進度會從 0 秒一路掃到目前段落的終點） */
  running: boolean;
  /** 每次重新播放遞增，用來重啟進度動畫 */
  playTick: number;
  reduceMotion: boolean;
};

/** 標籤之間至少保留的水平距離（px） */
const LABEL_GAP = 8;

type LabelSlot = { left: number; show: boolean };

/**
 * 計算每個標籤的位置與是否顯示：標籤右緣對齊段落終點（像時間軸刻度），
 * 擠不下時依優先順序保留——目前段落、最後一段，接著由長段往短段排，避免任何重疊。
 */
function layoutLabels(stages: readonly number[], stage: number, trackWidth: number, widths: number[]): LabelSlot[] {
  const total = stages[stages.length - 1];
  const slots = stages.map((sec, i) => {
    const end = (sec / total) * trackWidth;
    const left = Math.min(Math.max(end - widths[i], 0), Math.max(trackWidth - widths[i], 0));
    return { left, show: false };
  });
  const last = stages.length - 1;
  const order = [stage, last, ...stages.map((_, i) => last - i).filter((i) => i !== stage && i !== last)];
  const taken: Array<[number, number]> = [];
  for (const i of order) {
    const a = slots[i].left;
    const b = a + widths[i];
    if (taken.every(([x, y]) => b + LABEL_GAP <= x || a >= y + LABEL_GAP)) {
      taken.push([a, b]);
      slots[i].show = true;
    }
  }
  return slots;
}

export function StreakTimeline({ stages, stage, running, playTick, reduceMotion }: Props) {
  const total = stages[stages.length - 1];
  const trackRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [slots, setSlots] = useState<LabelSlot[] | null>(null);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const widths = stages.map((_, i) => labelRefs.current[i]?.offsetWidth ?? 0);
      setSlots(layoutLabels(stages, stage, track.clientWidth, widths));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    labelRefs.current.forEach((el) => el && ro.observe(el));
    // 字型載入完成後標籤寬度會變，重新量一次
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [stages, stage]);

  return (
    <div className="streak-timeline" role="img" aria-label={`第 ${stage + 1} 段，共 ${stages.length} 段，目前可聽 ${stages[stage]} 秒`}>
      <div className="streak-track" ref={trackRef}>
        {stages.map((sec, i) => {
          const prev = i === 0 ? 0 : stages[i - 1];
          const state = i < stage ? 'is-done' : i === stage ? 'is-now' : 'is-locked';
          const run = running && !reduceMotion && i <= stage;
          return (
            <span
              key={sec}
              className={`streak-seg ${state}`}
              style={{ left: `${(prev / total) * 100}%`, width: `${((sec - prev) / total) * 100}%` }}
            >
              <i className="streak-seg-fill" />
              {run && (
                <i
                  key={playTick}
                  className="streak-seg-run"
                  style={{ animationDuration: `${sec - prev}s`, animationDelay: `${prev}s` }}
                />
              )}
            </span>
          );
        })}
      </div>
      <div className="streak-labels" aria-hidden="true">
        {stages.map((sec, i) => {
          const slot = slots?.[i];
          const state = i < stage ? 'is-done' : i === stage ? 'is-now' : 'is-locked';
          return (
            <span
              key={sec}
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className={`streak-label ${state}${slot?.show ? ' is-shown' : ''}`}
              style={{ transform: `translateX(${slot?.left ?? 0}px)` }}
            >
              {sec}s
            </span>
          );
        })}
      </div>
    </div>
  );
}
