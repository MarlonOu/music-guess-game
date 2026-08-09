'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { GameMode } from '../../lib/types/match';
import type { Song } from '../../lib/types/song';
import type { PlayerProfile } from '../../lib/types/player';
import type { Round } from '../../lib/types/match';
import { songRepository } from '../../lib/repository/songRepository';
import { playerRepository } from '../../lib/repository/playerRepository';
import { matchRepository } from '../../lib/repository/matchRepository';
import { DEFAULT_ROUND_COUNT, SOLO_PLAYER_KEY } from '../../lib/engine/gameEngine';
import { AudioController } from '../../lib/audio/audioController';
import { useGameEngine } from './useGameEngine';
import { QuestionRenderer } from './QuestionRenderer';

interface GamePageProps {
  mode: GameMode;
  title: string;
}

export function GamePage({ mode, title }: GamePageProps) {
  const { engine, state } = useGameEngine();
  const searchParams = useSearchParams();
  const [songPool, setSongPool] = useState<Song[] | null>(null);
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const matchIdRef = useRef<string | null>(null);
  const persistedRef = useRef(false);

  // 播放器容器與 AudioController 在整場比賽期間只建立一次，換題只呼叫 stop()／play()，
  // 不整個銷毀重建 —— 避免 YT.Player 掛載目標被拆除重建造成「player 未附加到 DOM」的競態。
  //
  // 注意：必須用「effect 內 new + setState」而非 useState(() => new ...) 的 lazy initializer。
  // React Strict Mode（開發模式）會將每個元件的 effect 故意執行「掛載→卸載→再掛載」一次以抓副作用問題；
  // lazy initializer 只算一次、物件是同一個，卸載那次的 dispose() 會把僅存的那個實例永久標記為已釋放。
  // 效果內每次執行都 new 一個全新物件，才能讓「再掛載」拿到未被釋放的乾淨實例（比照除錯頁 /debug-audio 的作法）。
  const playerContainerId = useId().replace(/:/g, '-');
  const [audioController, setAudioController] = useState<AudioController | null>(null);

  const playerIds = (searchParams.get('players') ?? '').split(',').filter(Boolean);
  const artistIds = (searchParams.get('artists') ?? '').split(',').filter(Boolean);
  const roundCountParam = Number(searchParams.get('rounds'));
  const roundCount = Number.isFinite(roundCountParam) && roundCountParam > 0 ? roundCountParam : DEFAULT_ROUND_COUNT;

  useEffect(() => {
    const controller = new AudioController(playerContainerId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 建立外部播放器物件屬於「連接外部系統」的合法例外，非可在 render 期間衍生的資料
    setAudioController(controller);
    return () => {
      controller.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 換題時先停止上一段播放，避免殘留播放中的音訊
  useEffect(() => {
    audioController?.stop();
  }, [audioController, state.currentQuestion]);

  useEffect(() => {
    let cancelled = false;

    // 保底逾時：正常情況下 setup() 應在數秒內完成，超過此時限代表某個非同步呼叫
    // （例如 IndexedDB 卡住）卡死未 resolve 也未 reject，需明確告知而非無限顯示「準備中」
    const timeoutHandle = setTimeout(() => {
      if (!cancelled) {
        setLoadError('初始化逾時，可能是本機資料庫（IndexedDB）卡住，請重新整理頁面後再試');
      }
    }, 8000);

    async function setup() {
      const songs = await songRepository.getByArtistIds(artistIds);
      if (cancelled) return;
      if (songs.length === 0) {
        setLoadError(
          artistIds.length > 0
            ? '篩選的歌手目前無任何歌曲，請重新選擇歌手篩選條件'
            : '目前題庫為空，無法開始遊戲'
        );
        return;
      }
      setSongPool(songs);

      let matchedPlayers: PlayerProfile[] = [];
      if (playerIds.length > 0) {
        const result = await playerRepository.getAll();
        if (!cancelled && result.ok && result.data) {
          matchedPlayers = result.data.filter((p) => playerIds.includes(p.id));
          setPlayers(matchedPlayers);
        }

        const matchId = crypto.randomUUID();
        matchIdRef.current = matchId;
        await matchRepository.createMatch({
          id: matchId,
          mode,
          artistFilterIds: artistIds,
          themeFilterIds: [],
          roundCount,
          createdAt: new Date().toISOString(),
        });
        await Promise.all(
          matchedPlayers.map((p) =>
            matchRepository.addMatchPlayer({ matchId, playerId: p.id, score: 0 })
          )
        );
      }

      if (cancelled) return;
      engine.start({
        mode,
        songPool: songs,
        roundCount,
        playerIds: matchedPlayers.length > 0 ? matchedPlayers.map((p) => p.id) : undefined,
      });
    }

    setup()
      .then(() => clearTimeout(timeoutHandle))
      .catch((err) => {
        clearTimeout(timeoutHandle);
        console.error('[GamePage] 遊戲初始化失敗：', err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '題庫讀取失敗');
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 比賽結束時，將 Round 與最終 MatchPlayer 分數寫入資料層（僅執行一次）
  useEffect(() => {
    if (state.status !== 'finished' || persistedRef.current) return;
    const matchId = matchIdRef.current;
    if (!matchId) return;
    persistedRef.current = true;

    const roundsByIndex = new Map<number, Round>();
    state.results.forEach((r) => {
      if (roundsByIndex.has(r.roundIndex)) return;
      roundsByIndex.set(r.roundIndex, {
        id: crypto.randomUUID(),
        matchId,
        songId: r.songId,
        clipStartSec: r.question.clipStartSec,
        lyricLineIndex: r.question.lyricLineIndex,
        order: r.roundIndex,
      });
    });

    Promise.all([
      ...Array.from(roundsByIndex.values()).map((round) => matchRepository.addRound(round)),
      ...players.map((p) =>
        matchRepository.addMatchPlayer({ matchId, playerId: p.id, score: state.scores[p.id] ?? 0 })
      ),
    ]);
  }, [state.status, state.results, state.scores, players]);

  const currentSong =
    state.currentQuestion && songPool
      ? songPool.find((s) => s.id === state.currentQuestion!.songId) ?? null
      : null;

  const lastResult = state.results[state.results.length - 1];
  const lastWinnerName =
    lastResult?.winnerPlayerId && lastResult.winnerPlayerId !== SOLO_PLAYER_KEY
      ? players.find((p) => p.id === lastResult.winnerPlayerId)?.displayName ?? null
      : null;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px',
        gap: '32px',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          MUSIC GUESS
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>{title}</h1>
      </header>

      {loadError && <p style={{ color: 'var(--error)' }}>{loadError}</p>}

      <div
        id={playerContainerId}
        style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '200px', height: '200px' }}
      />

      {!loadError && state.status === 'idle' && <p style={{ color: 'var(--ink-dim)' }}>準備中</p>}

      {(state.status === 'question' || state.status === 'reveal') && currentSong && state.currentQuestion && (
        <>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
            <span>
              第 {state.currentRoundIndex + 1} / {state.roundCount} 題
            </span>
          </div>
          <QuestionRenderer
            key={state.currentRoundIndex}
            question={state.currentQuestion}
            song={currentSong}
            controller={audioController}
          />

          {state.status === 'question' && (
            <button
              onClick={() => engine.revealAnswer()}
              style={{
                padding: '12px 28px',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                fontWeight: 600,
                fontSize: '1.05rem',
              }}
            >
              顯示正確答案
            </button>
          )}

          {state.status === 'reveal' && (
            <AwardPanel
              correctTitle={state.currentQuestion.correctTitle}
              players={players}
              onAward={(playerId) => engine.awardPoint(playerId)}
            />
          )}

          <ScoreStrip players={players} scores={state.scores} />
        </>
      )}

      {state.status === 'finished' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          {players.length > 0 ? (
            <ScoreBoard players={players} scores={state.scores} />
          ) : (
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '2rem' }}>
              {state.scores[SOLO_PLAYER_KEY] ?? 0} / {state.roundCount}
            </p>
          )}
          <p style={{ color: 'var(--ink-dim)' }}>
            比賽結束
            {lastWinnerName && `（最後一題：${lastWinnerName} 答對）`}
          </p>
        </div>
      )}
    </main>
  );
}

/** 顯示目前每位玩家（或單機模式）的即時分數，方便玩家隨時掌握戰況 */
function ScoreStrip({ players, scores }: { players: PlayerProfile[]; scores: Record<string, number> }) {
  if (players.length === 0) {
    return (
      <p style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
        得分 {scores[SOLO_PLAYER_KEY] ?? 0}
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
      {players.map((p) => (
        <span key={p.id}>
          {p.displayName} {scores[p.id] ?? 0}
        </span>
      ))}
    </div>
  );
}

/**
 * 揭曉答案後，顯示正確答案並讓使用者手動指定這題是誰答對（口頭搶答，App 不判斷文字對錯）。
 * 單機無人別模式（players 為空）簡化為「答對／答錯」兩個按鈕。
 */
function AwardPanel({
  correctTitle,
  players,
  onAward,
}: {
  correctTitle: string;
  players: PlayerProfile[];
  onAward: (playerId: string | null) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
      <p style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '1.5rem' }}>{correctTitle}</p>

      {players.length === 0 ? (
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => onAward(SOLO_PLAYER_KEY)}
            style={{
              padding: '10px 24px',
              borderRadius: '10px',
              border: 'none',
              background: 'var(--success)',
              color: 'var(--accent-ink)',
              fontWeight: 600,
            }}
          >
            答對
          </button>
          <button
            onClick={() => onAward(null)}
            style={{
              padding: '10px 24px',
              borderRadius: '10px',
              border: '1px solid var(--groove)',
              background: 'transparent',
              color: 'var(--ink)',
            }}
          >
            答錯
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '360px' }}>
          <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', textAlign: 'center' }}>
            這題誰答對了？
          </span>
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => onAward(p.id)}
              style={{
                padding: '10px 16px',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--success)',
                color: 'var(--accent-ink)',
                fontWeight: 600,
              }}
            >
              {p.displayName} 答對
            </button>
          ))}
          <button
            onClick={() => onAward(null)}
            style={{
              padding: '10px 16px',
              borderRadius: '10px',
              border: '1px solid var(--groove)',
              background: 'transparent',
              color: 'var(--ink)',
            }}
          >
            沒人答對
          </button>
        </div>
      )}
    </div>
  );
}

function ScoreBoard({ players, scores }: { players: PlayerProfile[]; scores: Record<string, number> }) {
  const ranked = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '240px' }}>
      {ranked.map((p, i) => (
        <li
          key={p.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderRadius: '10px',
            border: '1px solid var(--groove)',
            background: i === 0 ? 'var(--bg-raised)' : 'transparent',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span>{i === 0 ? '[1] ' : ''}{p.displayName}</span>
          <span>{scores[p.id] ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}
