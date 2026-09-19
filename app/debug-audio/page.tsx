'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { AudioController, AudioLoadState, AudioSource } from '../../lib/audio/audioController';

export default function DebugAudioPage() {
  const playerContainerId = useId().replace(/:/g, '-');
  const controllerRef = useRef<AudioController | null>(null);
  const [source, setSource] = useState<AudioSource>('youtube');
  const [videoId, setVideoId] = useState('dQw4w9WgXcQ');
  const [previewUrl, setPreviewUrl] = useState('');
  const [startSec, setStartSec] = useState(0);
  const [durationSec, setDurationSec] = useState<number | ''>('');
  const [loadState, setLoadState] = useState<AudioLoadState>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    controllerRef.current = new AudioController(playerContainerId);
    return () => {
      controllerRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const idOrUrl = source === 'youtube' ? videoId : previewUrl;

  async function handlePlayPause() {
    const controller = controllerRef.current;
    if (!controller || !idOrUrl) return;

    if (isPlaying) {
      controller.pause();
      setIsPlaying(false);
      return;
    }
    if (hasStarted && controller.getLoadState() === 'ready') {
      controller.resume();
      setIsPlaying(controller.getIsPlaying());
      return;
    }
    setHasStarted(true);
    await controller.play(source, idOrUrl, startSec, durationSec === '' ? undefined : durationSec);
    setLoadState(controller.getLoadState());
    setIsPlaying(controller.getIsPlaying());
  }

  function handleRestart() {
    const controller = controllerRef.current;
    if (!controller || !idOrUrl) return;
    setHasStarted(true);
    controller.play(source, idOrUrl, startSec, durationSec === '' ? undefined : durationSec).then(() => {
      setLoadState(controller.getLoadState());
      setIsPlaying(controller.getIsPlaying());
    });
  }

  function handleSourceChange(next: AudioSource) {
    setSource(next);
    setHasStarted(false);
    setIsPlaying(false);
    setLoadState('idle');
    controllerRef.current?.stop();
  }

  function handleIdOrUrlChange(next: string) {
    if (source === 'youtube') setVideoId(next);
    else setPreviewUrl(next);
    setHasStarted(false);
    setIsPlaying(false);
    setLoadState('idle');
    controllerRef.current?.stop();
  }

  const inputStyle = {
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid var(--groove)',
    background: 'var(--bg-raised)',
    color: 'var(--ink)',
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px',
        gap: '24px',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          DEBUG
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem' }}>播放測試（YouTube／Apple Music／Deezer）</h1>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '360px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => handleSourceChange('youtube')}
            style={{
              ...inputStyle,
              flex: 1,
              cursor: 'pointer',
              borderColor: source === 'youtube' ? 'var(--accent)' : 'var(--groove)',
              color: source === 'youtube' ? 'var(--accent)' : 'var(--ink)',
            }}
          >
            YouTube
          </button>
          <button
            onClick={() => handleSourceChange('apple')}
            style={{
              ...inputStyle,
              flex: 1,
              cursor: 'pointer',
              borderColor: source === 'apple' ? 'var(--accent)' : 'var(--groove)',
              color: source === 'apple' ? 'var(--accent)' : 'var(--ink)',
            }}
          >
            Apple Music
          </button>
          <button
            onClick={() => handleSourceChange('deezer')}
            style={{
              ...inputStyle,
              flex: 1,
              cursor: 'pointer',
              borderColor: source === 'deezer' ? 'var(--accent)' : 'var(--groove)',
              color: source === 'deezer' ? 'var(--accent)' : 'var(--ink)',
            }}
          >
            Deezer
          </button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
            {source === 'youtube'
              ? 'YouTube videoId（非完整網址）'
              : source === 'apple'
                ? 'Apple Music 試聽片段網址（appleMusicPreviewUrl）'
                : 'Deezer 試聽片段網址（deezerPreviewUrl）'}
          </span>
          <input
            value={idOrUrl}
            onChange={(e) => handleIdOrUrlChange(e.target.value.trim())}
            placeholder={
              source === 'youtube'
                ? '例如 dQw4w9WgXcQ'
                : source === 'apple'
                  ? '例如 https://audio-ssl.itunes.apple.com/.../preview.m4a'
                  : '例如 https://cdns-preview-x.dzcdn.net/stream/....mp3'
            }
            style={inputStyle}
          />
        </label>

        <div style={{ display: 'flex', gap: '12px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>起始秒數</span>
            <input
              type="number"
              min={0}
              value={startSec}
              onChange={(e) => setStartSec(Math.max(0, Number(e.target.value) || 0))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>播放秒數（留空=不限）</span>
            <input
              type="number"
              min={1}
              value={durationSec}
              onChange={(e) => setDurationSec(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
              style={inputStyle}
            />
          </label>
        </div>
      </div>

      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
        loadState: {loadState} ／ isPlaying: {String(isPlaying)}
      </p>
      {loadState === 'error' && (
        <p style={{ color: 'var(--error)', fontSize: '0.875rem' }}>
          載入失敗：{source === 'youtube'
            ? '檢查 videoId 是否正確、瀏覽器主控台是否有 YouTube API 相關錯誤（例如 CSP、CORS）'
            : '檢查試聽網址是否正確、有沒有過期（Apple 的試聽網址偶爾會失效，需要重新查詢）'}
        </p>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handlePlayPause}
          style={{
            padding: '10px 24px',
            borderRadius: '8px',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            fontWeight: 600,
            minWidth: '96px',
          }}
        >
          {isPlaying ? '暫停' : hasStarted ? '繼續播放' : '播放'}
        </button>
        {hasStarted && (
          <button
            onClick={handleRestart}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid var(--groove)',
              background: 'transparent',
              color: 'var(--ink)',
            }}
          >
            從頭播放
          </button>
        )}
      </div>

      <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
        返回首頁
      </Link>
    </main>
  );
}
