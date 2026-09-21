'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { GameMode } from '../../lib/types/match';
import { roomRepository } from '../../lib/repository/roomRepository';
import { getGlobalAudioController } from '../../lib/audio/globalAudioController';

type PendingAction = 'create' | 'join' | null;

export default function OnlinePage() {
  return (
    <Suspense>
      <OnlinePageInner />
    </Suspense>
  );
}

function OnlinePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 從 QR Code 掃描進來的連結會帶 ?join=房號，自動代入「加入房間」表單並直接展開，
  // 不用讓使用者還要先點一次「加入房間」按鈕、再手動打房號——這正是 QR Code 想省掉的那一步。
  const joinCodeFromUrl = searchParams.get('join')?.trim().toUpperCase() ?? '';
  const [pending, setPending] = useState<PendingAction>(joinCodeFromUrl ? 'join' : null);
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCode] = useState(joinCodeFromUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 一進這個頁面就先背景把播放器建好（不需要使用者手勢，純建立空播放器不受限制）。
  // 這樣使用者實際點擊「建立房間／加入房間」時，unlock() 裡的 ensurePlayer() 幾乎瞬間完成，
  // 緊接著的 playVideo() 呼叫才能真正落在使用者手勢的有效期內，解鎖才有意義——
  // 如果播放器要等點擊之後才臨時建立（可能耗時 1~2 秒），解鎖的播放呼叫就會太晚，等於白做工。
  useEffect(() => {
    getGlobalAudioController().preload();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    // 這裡是真正的使用者手勢（表單送出點擊），且在任何 await 之前立刻呼叫——
    // 不等待其完成（不 await），讓它在背景解鎖播放器，不拖慢建立房間的流程。
    // 詳見 AudioController.unlock() 的說明。
    getGlobalAudioController().unlock();
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      setError('請輸入暱稱');
      return;
    }
    setLoading(true);
    setError(null);
    // 建立房間先固定用 INTRO 模式起始值，進到準備室後房主可以再改
    const result = await roomRepository.create(trimmed, 'INTRO' as GameMode);
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? '建立房間失敗');
      return;
    }
    sessionStorage.setItem(`room-player-${result.data.room.joinCode}`, result.data.playerId);
    // 額外存暱稱：房間頁面偵測到「自己不在玩家名單裡了」（例如重新整理頁面時，pagehide
    // 事件被誤判成離開，把自己的紀錄刪掉了）時，需要用同樣的暱稱自動重新加入，見該頁面說明。
    sessionStorage.setItem(`room-player-name-${result.data.room.joinCode}`, trimmed);
    router.push(`/online/room/${result.data.room.joinCode}`);
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    // 同 handleCreate：真實使用者手勢，在任何 await 之前立刻觸發解鎖。
    getGlobalAudioController().unlock();
    const trimmedName = displayName.trim();
    const trimmedCode = joinCode.trim().toUpperCase();
    if (trimmedName.length === 0) {
      setError('請輸入暱稱');
      return;
    }
    if (trimmedCode.length === 0) {
      setError('請輸入房間代碼');
      return;
    }
    setLoading(true);
    setError(null);
    const result = await roomRepository.join(trimmedCode, trimmedName);
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? '加入房間失敗');
      return;
    }
    sessionStorage.setItem(`room-player-${result.data.room.joinCode}`, result.data.playerId);
    sessionStorage.setItem(`room-player-name-${result.data.room.joinCode}`, trimmedName);
    router.push(`/online/room/${result.data.room.joinCode}`);
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '32px',
        padding: '24px',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          MUSIC GUESS · ONLINE
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', marginTop: '8px' }}>線上模式</h1>
      </div>

      {!pending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '360px' }}>
          <button onClick={() => setPending('create')} className="btn btn-primary btn-block">
            建立房間
          </button>
          <button onClick={() => setPending('join')} className="btn btn-secondary btn-block">
            加入房間
          </button>
        </div>
      )}

      {pending && (
        <form
          onSubmit={pending === 'create' ? handleCreate : handleJoin}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
            maxWidth: '360px',
            padding: '20px',
            borderRadius: '14px',
            border: '1px solid var(--groove)',
            background: 'var(--bg-raised)',
          }}
        >
          <span style={{ fontSize: '1rem', fontWeight: 600 }}>
            {pending === 'create' ? '建立房間' : '加入房間'}
          </span>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>你的暱稱</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="輸入暱稱"
              autoFocus
              className="field"
            />
          </label>

          {pending === 'join' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>房間代碼</span>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="例如 AB12CD"
                className="field"
                style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}
              />
            </label>
          )}

          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ flex: 1 }}>
              {loading ? '處理中…' : pending === 'create' ? '建立並進入' : '加入並進入'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPending(null);
                setError(null);
              }}
              className="btn btn-ghost"
            >
              返回
            </button>
          </div>
        </form>
      )}

      <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
        返回首頁
      </Link>
    </main>
  );
}
