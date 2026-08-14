'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { RoomState, RoomMessage } from '../../../../lib/types/room';
import type { GameMode } from '../../../../lib/types/match';
import type { Artist, Theme } from '../../../../lib/types/theme';
import { roomRepository } from '../../../../lib/repository/roomRepository';
import { songRepository } from '../../../../lib/repository/songRepository';
import { AudioController, type AudioPlaybackStatus } from '../../../../lib/audio/audioController';
import { getGlobalAudioController } from '../../../../lib/audio/globalAudioController';
import { ArtistFilter } from '../../../../components/filter/ArtistFilter';
import { ThemeFilter } from '../../../../components/filter/ThemeFilter';
import { AudioStatusIndicator } from '../../../../components/game/AudioStatusIndicator';

const MODES: { code: GameMode; label: string }[] = [
  { code: 'INTRO', label: '前奏猜歌' },
  { code: 'RANDOM_CLIP', label: '隨機片段猜歌' },
  { code: 'LYRIC_LINE', label: '歌詞猜歌' },
];

// 房間狀態改為 1 秒輪詢一次（原本 1.5 秒）；更重要的優化是「自己做的動作」不再等下一次輪詢，
// 送出後立刻套用伺服器回傳的最新狀態，這才是先前感覺到延遲的主因。
const POLL_INTERVAL_MS = 1000;
// 每題播放前的倒數秒數，所有玩家依同一個 roundStartedAt 時間戳計算，盡量讓大家幾乎同時開始聽
const COUNTDOWN_SEC = 3;
// 答案公布後，幾秒內沒有房主手動操作就自動進下一題
const AUTO_NEXT_SEC = 3;

export default function OnlineRoomPage() {
  const params = useParams<{ joinCode: string }>();
  const joinCode = params.joinCode.toUpperCase();
  const router = useRouter();

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastMessageAtRef = useRef<string | null>(null);

  // 先確認這個瀏覽器分頁有沒有這個房間的 playerId（建立/加入房間時存的）；
  // 沒有的話（例如直接貼連結開新分頁）顯示補填暱稱的表單，補加入房間後才能繼續。
  useEffect(() => {
    const stored = sessionStorage.getItem(`room-player-${joinCode}`);
    // 讀取 sessionStorage（外部系統）決定初始狀態的合法例外，必須在掛載後才能讀取
    // （伺服器端渲染時沒有 sessionStorage），無法用 lazy initializer 避免 SSR 內容不一致
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setPlayerId(stored);
  }, [joinCode]);

  // 輪詢房間狀態
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const result = await roomRepository.getState(joinCode);
      if (cancelled) return;
      if (result.ok && result.data) {
        setRoom(result.data);
        setError(null);
      } else {
        setError(result.error ?? '找不到這個房間，可能已被房主關閉');
        setRoom(null);
      }
    }
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [joinCode]);

  // 輪詢聊天室訊息
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const result = await roomRepository.getMessages(joinCode, lastMessageAtRef.current ?? undefined);
      if (cancelled || !result.ok || !result.data) return;
      if (result.data.length > 0) {
        setMessages((prev) => {
          // 送出訊息當下已經樂觀新增過一次（見 handleSendMessage），這裡用 id 去重避免同一則訊息重複顯示兩次
          const seen = new Set(prev.map((m) => m.id));
          const fresh = result.data!.filter((m) => !seen.has(m.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
        lastMessageAtRef.current = result.data[result.data.length - 1].createdAt;
      }
    }
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [joinCode]);

  // 使用者關閉分頁／切換到其他網址時，盡量把離開通知送到伺服器（房主離開＝刪除房間）。
  // sendBeacon 是瀏覽器專門為「頁面卸載當下要送出的請求」設計的 API，比 fetch 在這個時機點可靠。
  useEffect(() => {
    if (!playerId) return;
    function handleUnload() {
      roomRepository.leaveBeacon(joinCode, playerId!);
    }
    window.addEventListener('pagehide', handleUnload);
    return () => window.removeEventListener('pagehide', handleUnload);
  }, [joinCode, playerId]);

  async function handleLeaveClick() {
    if (playerId) {
      await roomRepository.leave(joinCode, playerId);
    }
    router.push('/online');
  }

  function handleMessageSent(message: RoomMessage) {
    // 送出成功就直接把伺服器回傳的訊息加進畫面，不用等下一次輪詢才看到自己剛打的字
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    lastMessageAtRef.current = message.createdAt;
  }

  if (error && !room) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
        <p style={{ color: 'var(--error)' }}>{error}</p>
        <Link href="/online" style={{ color: 'var(--ink-dim)' }}>返回線上模式入口</Link>
      </main>
    );
  }

  if (!playerId) {
    return <JoinPrompt joinCode={joinCode} onJoined={setPlayerId} />;
  }

  if (!room) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--ink-dim)' }}>連線中…</p>
      </main>
    );
  }

  const isHost = room.hostPlayerId === playerId;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 20px',
        gap: '24px',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          MUSIC GUESS · ONLINE
        </span>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '1.1rem',
            letterSpacing: '0.15em',
          }}
        >
          房號 {room.joinCode}
        </div>
      </header>

      {room.status === 'lobby' && (
        <LobbyView room={room} playerId={playerId} isHost={isHost} onError={setError} onRoomUpdate={setRoom} />
      )}
      {room.status === 'playing' && (
        <PlayingView room={room} playerId={playerId} isHost={isHost} onError={setError} onRoomUpdate={setRoom} />
      )}
      {room.status === 'finished' && (
        <FinishedView room={room} playerId={playerId} isHost={isHost} onError={setError} onRoomUpdate={setRoom} />
      )}

      {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}

      <ChatBox joinCode={joinCode} playerId={playerId} messages={messages} onMessageSent={handleMessageSent} />

      <button
        onClick={handleLeaveClick}
        style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', background: 'transparent', border: 'none' }}
      >
        離開房間
      </button>
    </main>
  );
}

function JoinPrompt({ joinCode, onJoined }: { joinCode: string; onJoined: (playerId: string) => void }) {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      setError('請輸入暱稱');
      return;
    }
    setLoading(true);
    const result = await roomRepository.join(joinCode, trimmed);
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? '加入房間失敗');
      return;
    }
    sessionStorage.setItem(`room-player-${joinCode}`, result.data.playerId);
    onJoined(result.data.playerId);
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          width: '100%',
          maxWidth: '320px',
          padding: '20px',
          borderRadius: '14px',
          border: '1px solid var(--groove)',
          background: 'var(--bg-raised)',
        }}
      >
        <span style={{ fontWeight: 600 }}>加入房間 {joinCode}</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="輸入暱稱"
          autoFocus
          style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--groove)', background: 'var(--bg)', color: 'var(--ink)' }}
        />
        {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '12px', borderRadius: '10px', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}
        >
          {loading ? '處理中…' : '加入'}
        </button>
      </form>
    </main>
  );
}

interface RoomViewProps {
  room: RoomState;
  playerId: string;
  isHost: boolean;
  onError: (msg: string) => void;
  onRoomUpdate: (room: RoomState) => void;
}

/**
 * 顯示可掃描加入房間的 QR Code，讓朋友不用手動輸入 6 碼房號——手機打字麻煩，
 * 直接掃碼帶到 /online?join=房號，加入頁面會自動代入房號，只需要輸入暱稱即可。
 * 預設收合（多人在同一個實體空間才用得到，線上分散的朋友還是文字房號比較方便分享）。
 */
function QrJoinSection({ joinCode }: { joinCode: string }) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const joinUrl = `${window.location.origin}/online?join=${joinCode}`;
    QRCode.toDataURL(joinUrl, { width: 220, margin: 1 })
      .then(setDataUrl)
      .catch((err) => setError(err instanceof Error ? err.message : '產生 QR Code 失敗'));
  }, [open, joinCode]);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 16px',
          borderRadius: '999px',
          border: '1px solid var(--groove)',
          background: 'transparent',
          color: 'var(--ink-dim)',
          fontSize: '0.85rem',
        }}
      >
        {open ? '收合 QR Code ▲' : '📷 顯示 QR Code 讓朋友掃描加入 ▼'}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '12px' }}>
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}
          {dataUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- data URL 是本機即時產生的圖片，不是需要 Next Image 最佳化的外部/靜態資源
            <img src={dataUrl} alt={`掃描加入房間 ${joinCode}`} width={220} height={220} style={{ borderRadius: '8px' }} />
          )}
          <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>掃描後會自動帶入房號，只需要再輸入暱稱</span>
        </div>
      )}
    </section>
  );
}

function LobbyView({ room, playerId, isHost, onError, onRoomUpdate }: RoomViewProps) {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [starting, setStarting] = useState(false);
  // 篩選方式（依歌手／依主題）改用獨立的本地狀態追蹤，不再從 themeFilterIds.length 反推——
  // 原本的作法在「切換到主題篩選，但尚未勾選任何主題」時，themeFilterIds 仍是空陣列，
  // 跟「根本沒切換」無法區分，導致畫面切不過去，房主點了「依主題篩選」看起來像沒反應。
  const [filterMode, setFilterMode] = useState<'artist' | 'theme'>(
    room.themeFilterIds.length > 0 ? 'theme' : 'artist'
  );

  useEffect(() => {
    songRepository.getAllArtists().then(setArtists, () => {});
    songRepository.getAllThemes().then(setThemes, () => {});
  }, []);

  async function updateSettings(patch: { mode?: GameMode; artistFilterIds?: string[]; themeFilterIds?: string[] }) {
    const result = await roomRepository.updateSettings(room.joinCode, playerId, patch);
    if (!result.ok) {
      onError(result.error ?? '更新設定失敗');
      return;
    }
    // 立刻套用剛剛送出成功的結果，不用等下一次輪詢——這就是先前「點選會延遲」的主因
    if (result.data) onRoomUpdate(result.data);
  }

  async function handleStart() {
    setStarting(true);
    const result = await roomRepository.start(room.joinCode, playerId);
    setStarting(false);
    if (!result.ok) {
      onError(result.error ?? '開始遊戲失敗');
      return;
    }
    if (result.data) onRoomUpdate(result.data);
  }

  const modeLabel = MODES.find((m) => m.code === room.mode)?.label ?? room.mode;
  const filterSummary =
    room.artistFilterIds.length > 0
      ? `歌手篩選：${room.artistFilterIds.map((id) => artists.find((a) => a.id === id)?.name ?? id).join('、')}`
      : room.themeFilterIds.length > 0
        ? `主題篩選：${room.themeFilterIds.map((id) => themes.find((t) => t.id === id)?.name ?? id).join('、')}`
        : '使用全部題庫';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '480px' }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>房間內玩家（{room.players.length}）</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {room.players.map((p) => (
            <span
              key={p.id}
              style={{
                padding: '6px 12px',
                borderRadius: '999px',
                border: '1px solid var(--groove)',
                background: 'var(--bg-raised)',
                fontSize: '0.9rem',
              }}
            >
              {p.displayName}
              {p.id === room.hostPlayerId && ' 👑'}
            </span>
          ))}
        </div>
      </section>

      <QrJoinSection joinCode={room.joinCode} />

      {isHost ? (
        <>
          <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>模式</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {MODES.map((m) => (
                <button
                  key={m.code}
                  onClick={() => updateSettings({ mode: m.code })}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '10px',
                    border: room.mode === m.code ? '1px solid var(--accent)' : '1px solid var(--groove)',
                    background: room.mode === m.code ? 'var(--bg-raised)' : 'transparent',
                    color: room.mode === m.code ? 'var(--accent)' : 'var(--ink)',
                    fontSize: '0.9rem',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
              題庫篩選方式（歌手／主題擇一，不能同時套用）
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => {
                  setFilterMode('artist');
                  if (room.themeFilterIds.length > 0) updateSettings({ themeFilterIds: [] });
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  border: filterMode === 'artist' ? '1px solid var(--accent)' : '1px solid var(--groove)',
                  background: filterMode === 'artist' ? 'var(--bg-raised)' : 'transparent',
                  color: filterMode === 'artist' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '0.9rem',
                }}
              >
                依歌手篩選
              </button>
              <button
                onClick={() => {
                  setFilterMode('theme');
                  if (room.artistFilterIds.length > 0) updateSettings({ artistFilterIds: [] });
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  border: filterMode === 'theme' ? '1px solid var(--accent)' : '1px solid var(--groove)',
                  background: filterMode === 'theme' ? 'var(--bg-raised)' : 'transparent',
                  color: filterMode === 'theme' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '0.9rem',
                }}
              >
                依主題篩選
              </button>
            </div>

            {filterMode === 'artist' ? (
              <ArtistFilter
                artists={artists}
                selectedIds={room.artistFilterIds}
                onToggle={(id) =>
                  updateSettings({
                    artistFilterIds: room.artistFilterIds.includes(id)
                      ? room.artistFilterIds.filter((x) => x !== id)
                      : [...room.artistFilterIds, id],
                    themeFilterIds: [],
                  })
                }
              />
            ) : (
              <ThemeFilter
                themes={themes}
                selectedIds={room.themeFilterIds}
                onToggle={(id) =>
                  updateSettings({
                    themeFilterIds: room.themeFilterIds.includes(id)
                      ? room.themeFilterIds.filter((x) => x !== id)
                      : [...room.themeFilterIds, id],
                    artistFilterIds: [],
                  })
                }
              />
            )}
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>不勾選任何項目 = 使用全部題庫</span>
          </section>

          <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>每場固定 10 題（若題庫不足 10 首則以實際數量為準）。</p>

          <button
            onClick={handleStart}
            disabled={starting}
            style={{
              padding: '14px',
              borderRadius: '12px',
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--accent-ink)',
              fontWeight: 600,
              fontSize: '1.05rem',
            }}
          >
            {starting ? '開始中…' : '開始遊戲'}
          </button>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
          <p style={{ color: 'var(--ink-dim)', textAlign: 'center' }}>
            等待房主（{room.players.find((p) => p.id === room.hostPlayerId)?.displayName}）開始遊戲…
          </p>
          {/* 非房主也能即時看到房主目前選了什麼模式與篩選條件，不用等開始遊戲才知道 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              padding: '12px 16px',
              borderRadius: '10px',
              border: '1px solid var(--groove)',
              background: 'var(--bg-raised)',
              fontSize: '0.85rem',
              color: 'var(--ink-dim)',
              width: '100%',
            }}
          >
            <span>目前模式：{modeLabel}</span>
            <span>{filterSummary}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayingView({ room, playerId, isHost, onError, onRoomUpdate }: RoomViewProps) {
  const [audioController, setAudioController] = useState<AudioController | null>(null);
  // 倒數中顯示的秒數；0 代表倒數已結束、正常播放中
  const [countdown, setCountdown] = useState(0);
  // 訂閱 AudioController 的播放狀態回呼，用來畫出跟單機模式一致的載入中／播放中／已暫停／
  // 播放完畢／失敗動畫（見 AudioStatusIndicator）。狀態在每題開始時會被 stop() 重置為 'idle'。
  const [audioStatus, setAudioStatus] = useState<AudioPlaybackStatus>('idle');
  const autoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playedRoundRef = useRef<number>(-1);
  const [voting, setVoting] = useState(false);

  async function handleNext() {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    const result = await roomRepository.next(room.joinCode, playerId);
    if (!result.ok) {
      onError(result.error ?? '推進題目失敗');
      return;
    }
    if (result.data) onRoomUpdate(result.data);
  }

  async function handleEnd() {
    if (!window.confirm('確定要提前結束這場比賽嗎？')) return;
    const result = await roomRepository.end(room.joinCode, playerId);
    if (!result.ok) {
      onError(result.error ?? '結束比賽失敗');
      return;
    }
    if (result.data) onRoomUpdate(result.data);
  }

  async function handleVoteSkip() {
    setVoting(true);
    const result = await roomRepository.voteSkip(room.joinCode, playerId);
    setVoting(false);
    if (!result.ok) {
      onError(result.error ?? '投票跳題失敗');
      return;
    }
    if (result.data) onRoomUpdate(result.data);
  }

  useEffect(() => {
    // 改用全域共用的單一播放器實例（見 globalAudioController.ts），而不是在這裡各自建立、
    // 掛載時建立、卸載時 dispose——玩家在「/online」頁面點擊加入／建立房間當下，
    // 已經用這個共用實例做過一次真正的使用者手勢播放解鎖（AudioController.unlock()），
    // 沿用同一個實例，解鎖才對接下來的自動播放真正有效；若在這裡重新 new 一個實例，
    // 等於換了一個從沒被解鎖過的播放器，先前的解鎖就白做了。
    const controller = getGlobalAudioController();
    controller.setOnStatusChange(setAudioStatus);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 取得外部共用物件屬於「連接外部系統」的合法例外
    setAudioController(controller);
    // 進畫面就先確保播放器已就緒（多半這時候已經在 /online 頁面 preload 過，這裡是保險，
    // 避免玩家用分享連結直接進到房間、跳過 /online 頁面的情況）。
    controller.preload();
    return () => {
      controller.setOnStatusChange(undefined);
      // 停止播放（但不呼叫 dispose()——這是全域共用實例，播放器本身要留給下一場遊戲／
      // 下一個房間繼續使用，只是「這一輪的播放」要在離開這個畫面時停掉）。
      // 這是先前「離開房間後音樂還在播」的成因：這裡以前只取消訂閱狀態回呼，忘了真的停止播放，
      // 玩家點離開、切到 finished 畫面、或整個房間頁面卸載時，播放器完全沒被通知要停下來。
      controller.stop();
    };
  }, []);

  // 每題開始都先倒數 COUNTDOWN_SEC 秒（所有玩家依同一個 roundStartedAt 計算，倒數結束的時間點一致），
  // 倒數結束才真正呼叫 play()；換題（currentRoundIndex 改變）時重置。
  // 用 200ms 的輪詢計算「現在該顯示第幾秒倒數」，跟房間狀態的輪詢頻率無關，倒數動畫才會平順。
  //
  // 播放長度：不再設自動停止時間（不傳 durationSec 給 play()），讓歌曲完整播放到結束為止，
  // 直到玩家答對公布答案（見下面 revealed 的 effect 會呼叫 stop()）或房主手動進下一題。
  useEffect(() => {
    playedRoundRef.current = -1;
    audioController?.stop();

    if (!room.roundStartedAt) return;
    const audioStartAt = new Date(room.roundStartedAt).getTime() + COUNTDOWN_SEC * 1000;

    const tick = () => {
      const msLeft = audioStartAt - Date.now();
      if (msLeft > 0) {
        setCountdown(Math.ceil(msLeft / 1000));
        return;
      }
      setCountdown(0);
      if (playedRoundRef.current === room.currentRoundIndex) return;
      playedRoundRef.current = room.currentRoundIndex;

      if (!audioController || !room.currentSongVideoId || !room.currentQuestion) return;
      if (room.currentQuestion.renderType === 'text-lyric') return;

      // elapsedSec：晚進這一題的玩家（例如中途重新整理頁面）從目前應該播到的秒數接續播放，
      // 而不是從頭開始，盡量跟其他玩家同步；沒有上限時長，會一路播到歌曲本身結束為止。
      const elapsedSec = Math.max(0, -msLeft / 1000);
      if (room.currentQuestion.renderType === 'audio-intro') {
        audioController.play(room.currentSongVideoId, elapsedSec);
      } else if (room.currentQuestion.renderType === 'audio-clip') {
        const clipStart = room.currentQuestion.clipStartSec ?? 0;
        audioController.play(room.currentSongVideoId, clipStart + elapsedSec);
      }
    };

    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioController, room.currentRoundIndex, room.roundStartedAt]);

  // 答案公布（revealed 從 false 變 true）時停止播放，避免繼續播放蓋過大家的討論；
  // 房主端額外啟動一個 AUTO_NEXT_SEC 秒的計時器，時間到自動進下一題（非房主不觸發，避免多人同時搶著呼叫 API）。
  useEffect(() => {
    if (!room.revealed) return;
    audioController?.stop();

    if (!isHost) return;
    autoNextTimerRef.current = setTimeout(() => {
      handleNext();
    }, AUTO_NEXT_SEC * 1000);

    return () => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioController, room.revealed, room.currentRoundIndex, isHost]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', width: '100%', maxWidth: '480px' }}>
      <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
        第 {room.currentRoundIndex + 1} / {room.roundCount} 題
      </span>

      {countdown > 0 && (
        <p style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', color: 'var(--accent)' }}>{countdown}</p>
      )}

      {countdown === 0 && room.currentQuestion?.renderType === 'text-lyric' && (
        <div
          style={{
            padding: '32px',
            borderRadius: '16px',
            background: 'var(--bg-raised)',
            border: '1px solid var(--groove)',
            fontFamily: 'var(--font-display)',
            fontSize: '1.4rem',
            textAlign: 'center',
            maxWidth: '480px',
          }}
        >
          {room.currentQuestion.lyricLineText || '（此題無可用歌詞）'}
        </div>
      )}

      {countdown === 0 &&
        (room.currentQuestion?.renderType === 'audio-intro' || room.currentQuestion?.renderType === 'audio-clip') && (
          <AudioStatusIndicator status={audioStatus} />
        )}

      {countdown === 0 && !room.revealed && (
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', textAlign: 'center' }}>
          在下方聊天室打歌名搶答，答對自動得分並公布答案
        </p>
      )}

      {countdown === 0 && !room.revealed && (
        <button
          onClick={handleVoteSkip}
          disabled={voting}
          style={{
            padding: '8px 20px',
            borderRadius: '999px',
            border: room.skipVotePlayerIds.includes(playerId) ? '1px solid var(--accent)' : '1px solid var(--groove)',
            background: room.skipVotePlayerIds.includes(playerId) ? 'var(--bg-raised)' : 'transparent',
            color: room.skipVotePlayerIds.includes(playerId) ? 'var(--accent)' : 'var(--ink-dim)',
            fontSize: '0.9rem',
          }}
        >
          {voting
            ? '處理中…'
            : room.skipVotePlayerIds.includes(playerId)
              ? `已投票跳題（${room.skipVotePlayerIds.length}/${room.players.length}）· 點我收回`
              : `投票跳題（${room.skipVotePlayerIds.length}/${room.players.length}）`}
        </button>
      )}

      {countdown === 0 && !room.revealed && room.skipVotePlayerIds.length > 0 && (
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', textAlign: 'center' }}>
          全員都投票跳題，這題就會流局並直接公布答案
        </p>
      )}

      {room.revealed && room.currentQuestion?.correctTitle && (
        <>
          <p style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '1.4rem', textAlign: 'center' }}>
            {room.currentQuestion.correctTitle}
            {room.currentSongArtist && (
              <span style={{ color: 'var(--ink-dim)', fontWeight: 400, fontSize: '1rem' }}>
                {' '}– {room.currentSongArtist}
              </span>
            )}
          </p>
          {room.currentSongThemeLabels.length > 0 && (
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
              主題：{room.currentSongThemeLabels.join('、')}
            </p>
          )}
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>{AUTO_NEXT_SEC} 秒後自動進下一題</p>
        </>
      )}

      <ScoreList players={room.players} />

      {isHost && (
        <button
          onClick={handleEnd}
          style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid var(--groove)', background: 'transparent', color: 'var(--ink-dim)', fontSize: '0.85rem' }}
        >
          提前結束比賽
        </button>
      )}
    </div>
  );
}

function FinishedView({ room, isHost, onError, onRoomUpdate }: RoomViewProps) {
  const [restarting, setRestarting] = useState(false);

  async function handleRestart() {
    setRestarting(true);
    const result = await roomRepository.restart(room.joinCode, room.hostPlayerId);
    setRestarting(false);
    if (!result.ok) {
      onError(result.error ?? '重新開始失敗');
      return;
    }
    if (result.data) onRoomUpdate(result.data);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%', maxWidth: '360px' }}>
      <p style={{ color: 'var(--ink-dim)' }}>比賽結束</p>
      <ScoreList players={room.players} showRanking />
      {isHost && (
        <button
          onClick={handleRestart}
          disabled={restarting}
          style={{ padding: '12px 24px', borderRadius: '10px', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}
        >
          {restarting ? '處理中…' : '返回房間再玩一輪'}
        </button>
      )}
    </div>
  );
}

const ONLINE_MEDALS = ['🥇', '🥈', '🥉'];

function ScoreList({ players, showRanking }: { players: RoomState['players']; showRanking?: boolean }) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const topScore = ranked[0]?.score ?? 0;
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {ranked.map((p, i) => {
        const isTop = p.score === topScore && topScore > 0;
        return (
          <li
            key={p.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: showRanking ? '14px 18px' : '10px 16px',
              borderRadius: showRanking ? '14px' : '10px',
              border: showRanking && isTop ? '1px solid var(--accent)' : '1px solid var(--groove)',
              background: showRanking && isTop ? 'var(--bg-raised)' : 'transparent',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: showRanking ? '1.05rem' : '0.9rem' }}>
              <span style={{ width: '24px', textAlign: 'center' }}>{ONLINE_MEDALS[i] ?? `${i + 1}`}</span>
              {p.displayName}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: showRanking ? '1.3rem' : '1.05rem',
                color: showRanking && isTop ? 'var(--accent)' : 'var(--ink)',
              }}
            >
              {p.score}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ChatBox({
  joinCode,
  playerId,
  messages,
  onMessageSent,
}: {
  joinCode: string;
  playerId: string;
  messages: RoomMessage[];
  onMessageSent: (message: RoomMessage) => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setSending(true);
    const result = await roomRepository.sendMessage(joinCode, playerId, trimmed);
    setSending(false);
    if (result.ok) {
      setText('');
      // 送出成功立刻顯示在畫面上，不用等下一次輪詢——這就是先前「送出後有時會延遲才顯示」的主因
      if (result.data) onMessageSent(result.data);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%',
        maxWidth: '480px',
        padding: '12px',
        borderRadius: '14px',
        border: '1px solid var(--groove)',
        background: 'var(--bg-raised)',
      }}
    >
      <div
        ref={listRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '220px',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>聊天室：搶答也在這裡打字</p>
        )}
        {messages.map((m) => (
          <p
            key={m.id}
            style={{
              fontSize: '0.9rem',
              color: m.isCorrectAnswer ? 'var(--success)' : 'var(--ink)',
              fontWeight: m.isCorrectAnswer ? 600 : 400,
            }}
          >
            <span style={{ color: 'var(--ink-dim)' }}>{m.displayName}：</span>
            {m.text}
            {m.isCorrectAnswer && ' ✓ 答對'}
          </p>
        ))}
      </div>
      <form onSubmit={handleSend} style={{ display: 'flex', gap: '8px' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="打字聊天／搶答歌名"
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid var(--groove)',
            background: 'var(--bg)',
            color: 'var(--ink)',
          }}
        />
        <button
          type="submit"
          disabled={sending}
          style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}
        >
          送出
        </button>
      </form>
    </div>
  );
}
