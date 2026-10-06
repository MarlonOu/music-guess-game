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
import { RankBadge, PlayerIdentity } from './PlayerBadges';

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
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [covers, setCovers] = useState<Record<string, string | null>>({});

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

  // 切到下一題就先在背景查好這首歌的封面（Apple／Deezer／YouTube，由伺服器解析），公布答案時直接使用
  const currentSongId = currentSong?.id;
  useEffect(() => {
    if (!currentSongId || currentSongId in covers) return;
    let cancelled = false;
    fetch(`/api/songs/${encodeURIComponent(currentSongId)}/cover`)
      .then((r) => (r.ok ? r.json() : { coverUrl: null }))
      .catch(() => ({ coverUrl: null }))
      .then((data: { coverUrl: string | null }) => {
        if (!cancelled) setCovers((prev) => ({ ...prev, [currentSongId]: data.coverUrl }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSongId]);
  const coverUrl = currentSongId ? covers[currentSongId] ?? null : null;

  const roundNumber = state.currentRoundIndex + 1;
  const progressPct =
    state.unlimitedRounds || !state.roundCount
      ? 0
      : Math.min(100, ((roundNumber - (state.status === 'question' ? 1 : 0)) / state.roundCount) * 100);

  if (loadError || state.status === 'idle') {
    return (
      <main className="status-screen" aria-busy={!loadError}>
        <div className="status-screen-inner">
          {loadError ? (
            <>
              <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.4rem' }}>無法開始</h1>
              <p role="alert" style={{ color: 'var(--error)', fontSize: '0.92rem', lineHeight: 1.6 }}>
                {loadError}
              </p>
              <Link href="/match-setup" className="btn btn-primary">
                回到建立比賽
              </Link>
            </>
          ) : (
            <>
              <div className="loading-disc" />
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>準備中</p>
            </>
          )}
        </div>
      </main>
    );
  }

  if (state.status === 'finished') {
    return (
      <main className="shell">
        <div className="shell-inner" style={{ maxWidth: 420, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '2rem', letterSpacing: '-0.02em' }}>
            比賽結束
          </h1>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.92rem' }}>共 {state.results.length} 題</p>
          {hasPlayers && <ScoreBoard players={players} scores={state.scores} />}
          <div style={{ display: 'flex', gap: '10px', width: '100%', maxWidth: '360px' }}>
            <Link href="/match-setup" className="btn btn-primary" style={{ flex: 1 }}>
              再來一場
            </Link>
            <Link href="/" className="btn btn-ghost">
              首頁
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const revealing = state.status === 'reveal';

  return (
    <main className="play-shell">
      <div className="play-top">
        <div>
          {confirmEnd ? (
            <span style={{ display: 'inline-flex', gap: '6px' }}>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => engine.endMatchEarly()}>
                確定結束
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmEnd(false)}>
                取消
              </button>
            </span>
          ) : (
            <button type="button" className="shell-back" onClick={() => setConfirmEnd(true)} style={{ background: 'none', border: 'none' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              結束
            </button>
          )}
        </div>
        <div className="play-count" aria-live="polite">
          {state.unlimitedRounds ? (
            <>第 {roundNumber} 題</>
          ) : (
            <>
              {roundNumber}
              <span> / {state.roundCount}</span>
            </>
          )}
        </div>
        <div style={{ textAlign: 'right', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>{title}</div>
      </div>
      <div className="play-progress" aria-hidden="true">
        <i style={{ width: `${progressPct}%` }} />
      </div>

      <div className="play-body">
        {currentSong && state.currentQuestion && (
          <>
            <QuestionRenderer
              key={state.currentRoundIndex}
              question={state.currentQuestion}
              song={currentSong}
              controller={audioController}
              reveal={
                revealing
                  ? { title: state.currentQuestion.correctTitle, artist: currentArtistName, coverUrl: coverUrl }
                  : null
              }
            />
            {revealing && currentThemeLabels.length > 0 && (
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>主題：{currentThemeLabels.join('、')}</p>
            )}
            {hasPlayers && (
              <ScoreStrip
                players={players}
                scores={state.scores}
                canAdjust={revealing}
                onAdjust={(id, delta) => engine.awardPoint(id, delta)}
              />
            )}
          </>
        )}
      </div>

      <div className="play-bar">
        {!revealing ? (
          <button type="button" onClick={() => engine.revealAnswer()} className="btn btn-primary">
            顯示正確答案
          </button>
        ) : (
          <button type="button" onClick={() => engine.nextQuestion()} className="btn btn-primary">
            下一題
          </button>
        )}
      </div>
    </main>
  );
}

/**
 * 顯示每位玩家的即時分數，同時是加減分按鈕。
 * 加減分只在公布答案（reveal）後才能操作，避免答案還沒公布就先動分數；
 * 題目階段（question）仍會顯示目前分數，只是先不能點。
 *
 * PlayerIdentity／RankBadge 這兩個計分用的小元件是跟線上模式房間頁面
 * （app/online/room/[joinCode]/page.tsx）共用的，定義在 PlayerBadges.tsx，
 * 兩邊永遠用同一份邏輯，不會有「其中一邊修好了、另一邊忘記一起改」的情況。
 */

/**
 * 比賽進行中的即時計分——改成一張一張直向排列的小卡片，不再是一整排橫向膠囊。
 * 姓名（小、淡）在上，分數（大、金色、等寬數字字體）在中間獨自一行，加減分按鈕
 * 在最下面自成一排——三種不同性質的資訊（身分／數值／操作）各自佔一行，
 * 視覺上天生就分得開，不需要再靠顏色或字級去硬撐出區別。
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
    <div className="score-strip">
      {ranked.map((p) => (
        <div key={p.id} className="score-card">
          <PlayerIdentity id={p.id} name={p.displayName} />
          <span className="score-card-value">{scores[p.id] ?? 0}</span>
          {(
            <span className="score-card-adjust" style={{ visibility: canAdjust ? 'visible' : 'hidden' }} aria-hidden={!canAdjust}>
              <button
                type="button"
                tabIndex={canAdjust ? 0 : -1}
                onClick={() => onAdjust(p.id, -1)}
                aria-label={`${p.displayName} 減一分`}
                className="score-adjust"
              >
                −
              </button>
              <button
                type="button"
                tabIndex={canAdjust ? 0 : -1}
                onClick={() => onAdjust(p.id, 1)}
                aria-label={`${p.displayName} 加一分`}
                className="score-adjust is-plus"
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

function ScoreBoard({ players, scores }: { players: PlayerProfile[]; scores: Record<string, number> }) {
  const ranked = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  const topScore = ranked[0] ? scores[ranked[0].id] ?? 0 : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '360px' }}>
      
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
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <RankBadge rank={i + 1} />
                <PlayerIdentity id={p.id} name={p.displayName} />
              </span>
              <span
                style={{
                  flexShrink: 0,
                  minWidth: '36px',
                  textAlign: 'right',
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
