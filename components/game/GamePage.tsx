'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { GameMode } from '../../lib/types/match';
import type { Song } from '../../lib/types/song';
import type { Artist, Theme } from '../../lib/types/theme';
import type { PlayerProfile } from '../../lib/types/player';
import type { Round } from '../../lib/types/match';
import { songRepository } from '../../lib/repository/songRepository';
import { playerRepository } from '../../lib/repository/playerRepository';
import { matchRepository } from '../../lib/repository/matchRepository';
import { generateId } from '../../lib/utils/id';
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
  const [artists, setArtists] = useState<Artist[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
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
  const themeIds = (searchParams.get('themes') ?? '').split(',').filter(Boolean);
  const roundCountParam = Number(searchParams.get('rounds'));
  // 未指定 rounds 時，代表「玩完篩選出來的全部歌曲」，不限題數
  const explicitRoundCount = Number.isFinite(roundCountParam) && roundCountParam > 0 ? roundCountParam : undefined;

  useEffect(() => {
    const controller = new AudioController(playerContainerId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 建立外部播放器物件屬於「連接外部系統」的合法例外，非可在 render 期間衍生的資料
    setAudioController(controller);
    // 進畫面就先背景暖機（見 AudioController.preload() 註解），避免玩家第一次按播放時
    // 因為臨時建立播放器耗時而在手機上被判定手勢過期、載入失敗
    controller.preload();
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
      const songs = await songRepository.getFiltered({ artistIds, themeIds });
      if (cancelled) return;
      if (songs.length === 0) {
        setLoadError(
          artistIds.length > 0 || themeIds.length > 0
            ? '篩選條件下目前無任何歌曲，請重新選擇歌手／主題篩選條件'
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

        const matchId = generateId();
        matchIdRef.current = matchId;
        await matchRepository.createMatch({
          id: matchId,
          mode,
          artistFilterIds: artistIds,
          themeFilterIds: themeIds,
          roundCount: explicitRoundCount ?? songs.length,
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
        roundCount: explicitRoundCount,
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

  // 比賽結束時（含主動提前結束），將 Round 與最終 MatchPlayer 分數寫入資料層（僅執行一次）
  useEffect(() => {
    if (state.status !== 'finished' || persistedRef.current) return;
    const matchId = matchIdRef.current;
    if (!matchId) return;
    persistedRef.current = true;

    const roundsByIndex = new Map<number, Round>();
    state.results.forEach((r) => {
      if (roundsByIndex.has(r.roundIndex)) return;
      roundsByIndex.set(r.roundIndex, {
        id: generateId(),
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

  // 答案顯示歌手名稱、（若有依主題篩選）主題小標用，跟遊戲進度無關，獨立抓一次即可
  useEffect(() => {
    songRepository.getAllArtists().then(setArtists, () => {});
    songRepository.getAllThemes().then(setThemes, () => {});
  }, []);

  const currentSong =
    state.currentQuestion && songPool
      ? songPool.find((s) => s.id === state.currentQuestion!.songId) ?? null
      : null;

  const currentArtistName = currentSong ? artists.find((a) => a.id === currentSong.artistId)?.name : undefined;
  // 只有這場比賽本來就是「依主題篩選」時才顯示小標，且只列出這首歌「符合本場篩選」的主題
  // （一首歌可能同時屬於多個主題，但只有玩家選定的那些才跟這場比賽相關）
  const currentThemeLabels =
    currentSong && themeIds.length > 0
      ? currentSong.themeIds
          .filter((id) => themeIds.includes(id))
          .map((id) => themes.find((t) => t.id === id)?.name)
          .filter((name): name is string => Boolean(name))
      : [];

  // 這次沒有選任何對戰人別（單機無人別模式）就完全不顯示得分相關的畫面
  const hasPlayers = players.length > 0;

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

      {!loadError && state.status === 'idle' && <p style={{ color: 'var(--ink-dim)' }}>準備中</p>}

      {(state.status === 'question' || state.status === 'reveal') && currentSong && state.currentQuestion && (
        <>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
            <span>
              {state.unlimitedRounds ? `第 ${state.currentRoundIndex + 1} 題` : `第 ${state.currentRoundIndex + 1} / ${state.roundCount} 題`}
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
            <>
              <p style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '1.5rem', textAlign: 'center' }}>
                {state.currentQuestion.correctTitle}
                {currentArtistName && (
                  <span style={{ color: 'var(--ink-dim)', fontWeight: 400, fontSize: '1.05rem' }}>
                    {' '}– {currentArtistName}
                  </span>
                )}
              </p>
              {currentThemeLabels.length > 0 && (
                <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
                  主題：{currentThemeLabels.join('、')}
                </p>
              )}
              <button
                onClick={() => engine.nextQuestion()}
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
                下一題
              </button>
            </>
          )}

          {hasPlayers && (
            <ScoreStrip
              players={players}
              scores={state.scores}
              canAdjust={state.status === 'reveal'}
              onAdjust={(id, delta) => engine.awardPoint(id, delta)}
            />
          )}

          <button
            onClick={() => {
              if (window.confirm('確定要提前結束這場比賽嗎？')) engine.endMatchEarly();
            }}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid var(--groove)',
              background: 'transparent',
              color: 'var(--ink-dim)',
              fontSize: '0.85rem',
            }}
          >
            結束比賽
          </button>
        </>
      )}

      {state.status === 'finished' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          {hasPlayers && <ScoreBoard players={players} scores={state.scores} />}
          <p style={{ color: 'var(--ink-dim)' }}>比賽結束</p>
          <Link
            href="/"
            style={{
              padding: '10px 24px',
              borderRadius: '10px',
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--accent-ink)',
              fontWeight: 600,
            }}
          >
            返回首頁
          </Link>
        </div>
      )}
    </main>
  );
}

/**
 * 顯示每位玩家的即時分數，同時是加減分按鈕。
 * 加減分只在公布答案（reveal）後才能操作，避免答案還沒公布就先動分數；
 * 題目階段（question）仍會顯示目前分數，只是先不能點。
 */
function ScoreStrip({
  players,
  scores,
  canAdjust,
  onAdjust,
}: {
  players: PlayerProfile[];
  scores: Record<string, number>;
  canAdjust: boolean;
  onAdjust: (playerId: string, delta: 1 | -1) => void;
}) {
  const ranked = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  return (
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: '480px' }}>
      {ranked.map((p) => (
        <div
          key={p.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 8px 8px 16px',
            borderRadius: '999px',
            border: '1px solid var(--groove)',
            background: 'var(--bg-raised)',
          }}
        >
          <span style={{ fontSize: '0.9rem' }}>{p.displayName}</span>
          <span
            style={{
              minWidth: '28px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: '1.1rem',
              color: 'var(--accent)',
            }}
          >
            {scores[p.id] ?? 0}
          </span>
          {canAdjust && (
            <span style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => onAdjust(p.id, -1)}
                aria-label={`${p.displayName} 減一分`}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  border: '1px solid var(--groove)',
                  background: 'transparent',
                  color: 'var(--ink-dim)',
                  fontSize: '0.9rem',
                  lineHeight: 1,
                }}
              >
                −
              </button>
              <button
                onClick={() => onAdjust(p.id, 1)}
                aria-label={`${p.displayName} 加一分`}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--accent-ink)',
                  fontSize: '0.9rem',
                  lineHeight: 1,
                  fontWeight: 700,
                }}
              >
                +
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

function ScoreBoard({ players, scores }: { players: PlayerProfile[]; scores: Record<string, number> }) {
  const ranked = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  const topScore = ranked[0] ? scores[ranked[0].id] ?? 0 : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '360px' }}>
      <p style={{ textAlign: 'center', color: 'var(--ink-dim)', fontSize: '0.85rem', letterSpacing: '0.1em' }}>
        最終戰績
      </p>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {ranked.map((p, i) => {
          const score = scores[p.id] ?? 0;
          const isTopScore = score === topScore && topScore > 0;
          return (
            <li
              key={p.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 18px',
                borderRadius: '14px',
                border: isTopScore ? '1px solid var(--accent)' : '1px solid var(--groove)',
                background: isTopScore ? 'var(--bg-raised)' : 'transparent',
                boxShadow: isTopScore ? '0 0 0 1px var(--accent) inset' : 'none',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.05rem' }}>
                <span style={{ width: '28px', textAlign: 'center', fontSize: '1.2rem' }}>
                  {MEDALS[i] ?? `${i + 1}`}
                </span>
                {p.displayName}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: '1.3rem',
                  color: isTopScore ? 'var(--accent)' : 'var(--ink)',
                }}
              >
                {score}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
