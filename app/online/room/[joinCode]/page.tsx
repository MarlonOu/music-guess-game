'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { RoomState, RoomMessage, AnswerMode } from '../../../../lib/types/room';
import type { GameMode } from '../../../../lib/types/match';
import type { Artist, Theme } from '../../../../lib/types/theme';
import { roomRepository } from '../../../../lib/repository/roomRepository';
import { songRepository } from '../../../../lib/repository/songRepository';
import { AudioController, type AudioPlaybackStatus } from '../../../../lib/audio/audioController';
import { getGlobalAudioController } from '../../../../lib/audio/globalAudioController';
import { estimateServerNow } from '../../../../lib/client/serverClock';
import { COUNTDOWN_SEC, REVEAL_DISPLAY_MS } from '../../../../lib/constants/roomTiming';
import { ArtistFilter } from '../../../../components/filter/ArtistFilter';
import { ThemeFilter } from '../../../../components/filter/ThemeFilter';
import { AudioStatusIndicator } from '../../../../components/game/AudioStatusIndicator';

const MODES: { code: GameMode; label: string }[] = [
  { code: 'INTRO', label: '前奏猜歌' },
  { code: 'RANDOM_CLIP', label: '隨機片段猜歌' },
  { code: 'LYRIC_LINE', label: '歌詞猜歌' },
];

// 房間狀態輪詢間隔。這是「發現伺服器狀態變了」唯一還剩下的延遲來源——換題本身已經改成
// 伺服器端答對/流局當下就立刻算好、排定好開始時間（見 lib/server/advanceRound.ts），
// 不再依賴任何客戶端的本地計時器或額外一次 API 往返，所以能壓縮的只剩「多快發現」這一段。
// 也因為「自己做的動作」（送出猜題、投票）都是送出後立刻套用伺服器回傳的最新狀態，
// 不等下一次輪詢，這裡的間隔主要只影響「看別人的動作」的即時感，可以放心調快。
const POLL_INTERVAL_MS = 600;

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

  // 自我修復（保留作為防呆用途）：如果房間資料正常拿得到，但自己的 playerId 不在玩家名單裡了，
  // 就用先前存的暱稱自動重新加入，避免卡在一個看起來正常、但其實自己已經不是這個房間玩家的
  // 壞掉畫面。先前這個情況最常見的成因是 pagehide 誤判重新整理成離開，那個成因已經連根拔除
  // （見上面拿掉 pagehide 監聽的說明），這裡留著純粹是防呆——理論上不該再遇到，但如果未來
  // 又有其他原因讓玩家紀錄消失（例如房主之後如果做了踢人功能），至少不會卡死畫面。
  // 這個路徑重新加入拿到的是全新的 playerId，比分會歸零重算，是刻意接受的取捨。
  const rejoiningRef = useRef(false);
  useEffect(() => {
    if (!room || !playerId) return;
    if (room.players.some((p) => p.id === playerId)) return;
    if (rejoiningRef.current) return;

    const storedName = sessionStorage.getItem(`room-player-name-${joinCode}`);
    if (!storedName) {
      // 沒存暱稱（例如很舊的瀏覽器分頁），沒辦法自動重新加入，退回顯示補填暱稱的表單
      sessionStorage.removeItem(`room-player-${joinCode}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 跟上方讀取 sessionStorage 決定初始狀態同樣的合法例外，這裡是偵測到外部狀態（房間玩家名單）不同步後的修正動作
      setPlayerId(null);
      return;
    }

    rejoiningRef.current = true;
    roomRepository.join(joinCode, storedName).then((result) => {
      rejoiningRef.current = false;
      if (result.ok && result.data) {
        sessionStorage.setItem(`room-player-${joinCode}`, result.data.playerId);
        setPlayerId(result.data.playerId);
        setRoom(result.data.room);
      } else {
        // 重新加入也失敗（例如房間這期間已經結束、房主關閉了），才真的退回補填暱稱的表單
        sessionStorage.removeItem(`room-player-${joinCode}`);
        setPlayerId(null);
      }
    });
  }, [room, playerId, joinCode]);

  // 輪詢聊天室訊息；選擇題搶答模式不顯示聊天室 UI（見下方 ChatBox 的條件渲染），
  // 這裡就不用白白一直打 API 拉訊息，省一點行動網路流量跟電量。
  useEffect(() => {
    if (room?.answerMode === 'choice') return;
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
  }, [joinCode, room?.answerMode]);

  // 先前這裡有一個監聽 pagehide 事件、頁面卸載時自動送出離開通知的機制，已經移除：
  // pagehide 在「重新整理頁面」跟「真的關閉分頁」時都會觸發，沒辦法從事件本身分辨兩者，
  // 之前選擇「觸發就送出離開通知」的做法，代價比想像中大——玩家重新整理頁面時會被誤判成
  // 離開、整個玩家紀錄被刪除，連帶累積的分數也一起歸零（自我修復機制只能讓玩家用同樣的
  // 暱稱重新加入，但救不回已經被刪除的分數），手機上更會因為「重新整理後這個分頁其實從沒有
  // 真正的使用者手勢解鎖過播放權限」而導致音訊完全放不出來。改成只有玩家自己按下方的
  // 「離開房間」按鈕，才會真的把玩家從房間移除——關閉分頁但沒按離開的人，紀錄會留在房間裡
  // （比分不會消失），這是刻意的取捨：比起「重新整理就丟分、可能連音樂都放不出來」，
  // 「真正關閉分頁但沒按離開的人暫時還留在名單裡」的影響小得多。

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

      {/* 選擇題搶答模式不需要聊天室——答題完全透過選項按鈕，聊天室原本只是被動保留給
          純聊天用途，但在畫面寸土寸金的手機上多一塊沒有實際功能的區塊反而是干擾，
          乾脆整個不顯示，畫面更乾淨。打字搶答模式維持不變（聊天室本身就是搶答的管道）。 */}
      {room.answerMode !== 'choice' && (
        <ChatBox joinCode={joinCode} playerId={playerId} messages={messages} onMessageSent={handleMessageSent} answerMode={room.answerMode} />
      )}

      <button onClick={handleLeaveClick} className="btn-text">
        離開房間
      </button>
    </main>
  );
}

function JoinPrompt({ joinCode, onJoined }: { joinCode: string; onJoined: (playerId: string) => void }) {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 跟 /online 頁面同樣的道理：先背景把播放器建好，等一下 handleSubmit 裡的 unlock() 呼叫
  // 才能幾乎瞬間完成、真正落在使用者送出表單的手勢有效期內（見 AudioController.unlock() 的說明）。
  // 這個表單是「有人直接分享房間連結、跳過 /online 首頁」時的補加入路徑，開放中途加入後
  // 這個路徑會變得更常見（比賽進行中把連結傳給朋友），一樣需要做音訊解鎖，不然這批玩家
  // 進房間後會遇到「手機第一首歌沒聲音」的問題。
  useEffect(() => {
    getGlobalAudioController().preload();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 真正的使用者手勢（表單送出），在任何 await 之前立刻呼叫，不等待其完成。
    getGlobalAudioController().unlock();
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
    sessionStorage.setItem(`room-player-name-${joinCode}`, trimmed);
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
          className="field"
        />
        {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}
        <button type="submit" disabled={loading} className="btn btn-primary">
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
        className={`btn btn-toggle btn-sm ${open ? 'is-active' : ''}`}
        style={{ alignSelf: 'flex-start', borderRadius: '999px' }}
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

  async function updateSettings(patch: {
    mode?: GameMode;
    answerMode?: AnswerMode;
    artistFilterIds?: string[];
    themeFilterIds?: string[];
  }) {
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
                  className={`btn btn-toggle ${room.mode === m.code ? 'is-active' : ''}`}
                  style={{ flex: 1 }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>搶答方式</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => updateSettings({ answerMode: 'text' })}
                className={`btn btn-toggle ${room.answerMode === 'text' ? 'is-active' : ''}`}
                style={{ flex: 1 }}
              >
                打字搶答
              </button>
              <button
                onClick={() => updateSettings({ answerMode: 'choice' })}
                className={`btn btn-toggle ${room.answerMode === 'choice' ? 'is-active' : ''}`}
                style={{ flex: 1 }}
              >
                選擇題搶答
              </button>
            </div>
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.78rem' }}>
              {room.answerMode === 'choice'
                ? '每題顯示幾個選項（含干擾選項），第一個點對的人得分，比打字搶答更公平、更防偷查答案。'
                : '在下方聊天室打歌名搶答，第一個答對的人得分。'}
            </p>
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
                className={`btn btn-toggle ${filterMode === 'artist' ? 'is-active' : ''}`}
                style={{ flex: 1 }}
              >
                依歌手篩選
              </button>
              <button
                onClick={() => {
                  setFilterMode('theme');
                  if (room.artistFilterIds.length > 0) updateSettings({ artistFilterIds: [] });
                }}
                className={`btn btn-toggle ${filterMode === 'theme' ? 'is-active' : ''}`}
                style={{ flex: 1 }}
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

          <button onClick={handleStart} disabled={starting} className="btn btn-primary btn-block">
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
  // 是否還在「上一題答案公布」的過渡期間內（見下面 tick() 依 room.lastRevealedAt 這個絕對
  // 時間戳計算），這段期間顯示上一題的答案，不顯示新一題的倒數／播放內容
  const [showingLastReveal, setShowingLastReveal] = useState(false);
  // 訂閱 AudioController 的播放狀態回呼，用來畫出跟單機模式一致的載入中／播放中／已暫停／
  // 播放完畢／失敗動畫（見 AudioStatusIndicator）。狀態在每題開始時會被 stop() 重置為 'idle'。
  const [audioStatus, setAudioStatus] = useState<AudioPlaybackStatus>('idle');
  const playedRoundRef = useRef<number>(-1);
  const [voting, setVoting] = useState(false);
  // 選擇題搶答模式：記錄「目前這輪我點過哪個、對不對」，讓按鈕能立刻顯示視覺回饋
  // （綠色代表點對、紅色代表點錯），不用等下一次輪詢才看得到反應。換題時要重置。
  const [choiceFeedback, setChoiceFeedback] = useState<{ roundIndex: number; songId: string; correct: boolean } | null>(
    null
  );
  const [answeringChoice, setAnsweringChoice] = useState(false);
  // 這個播放器實例是否還沒被「真正的使用者手勢」解鎖過（見下方掛載 effect 的說明）；
  // 是的話畫面上會擋一個「點一下繼續播放」的按鈕，避免玩家帶著先前存的身分重新整理頁面
  // 回來後，音訊在行動裝置上完全放不出來卻毫無提示。
  const [needsUnlock, setNeedsUnlock] = useState(false);
  // 玩家點過「繼續播放」之後遞增，用來讓下面的播放 effect 重新跑一次、補上剛剛因為
  // needsUnlock 而被擋下的那次播放，不用複製一份播放邏輯在按鈕的 onClick 裡。
  const [unlockRetryToken, setUnlockRetryToken] = useState(0);

  async function handleTapToUnlock() {
    await getGlobalAudioController().unlock();
    setNeedsUnlock(false);
    setUnlockRetryToken((t) => t + 1);
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

  async function handleAnswerChoice(songId: string) {
    if (answeringChoice) return;
    setAnsweringChoice(true);
    const result = await roomRepository.answerChoice(room.joinCode, playerId, songId);
    setAnsweringChoice(false);
    if (!result.ok || !result.data) {
      onError(result.error ?? '搶答失敗');
      return;
    }
    setChoiceFeedback({ roundIndex: room.currentRoundIndex, songId, correct: result.data.correct });
    onRoomUpdate(result.data.room);
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
    // 判斷這個播放器實例是否曾經在真正的使用者手勢下解鎖過。玩家如果是帶著先前存的身分
    // 重新整理頁面回來（跳過建立/加入房間的表單，直接從 sessionStorage 復原這個身分），
    // 這個全新的頁面實例其實從沒被解鎖過——手機瀏覽器的自動播放限制是「每個頁面實例」
    // 各自獨立的狀態，不會因為玩家之前解鎖過就跨重新整理保留。不擋下來的話，接下來的
    // 自動播放會被瀏覽器悄悄擋掉，玩家會遇到「這題完全沒聲音、也不知道為什麼」的狀況。
    if (!controller.isUnlocked()) {
      setNeedsUnlock(true);
    }
    return () => {
      controller.setOnStatusChange(undefined);
      // 停止播放（但不呼叫 dispose()——這是全域共用實例，播放器本身要留給下一場遊戲／
      // 下一個房間繼續使用，只是「這一輪的播放」要在離開這個畫面時停掉）。
      controller.stop();
    };
  }, []);

  // 這個 effect 同時負責兩件事，理由是兩者都得依同一組絕對時間戳、用同一個 200ms 的 tick
  // 計算，拆成兩個 effect 反而會有兩邊時間算不準對不齊的風險：
  //
  // 1. 「上一題答案公布」的過渡期間（room.lastRevealedAt 起 REVEAL_DISPLAY_MS 毫秒內）：
  //    顯示上一題答案，不做任何倒數/播放動作。這段期間的長度、要不要顯示，完全由伺服器
  //    透過 lastRevealedAt 這個絕對時間戳決定，客戶端只是照時間戳計算「現在在不在這段期間內」，
  //    不管客戶端是剛好答對的那個人、旁觀的其他玩家、還是輪詢比較慢才發現的人，算出來的結果
  //    都一樣——這是關鍵：換題不再依賴「房主端的本地計時器跑完才觸發」，而是伺服器在答對/
  //    流局那一刻就已經把下一題的開始時間排定好了（見 lib/server/advanceRound.ts），
  //    這裡單純是「讀時間戳、決定畫面」，沒有任何一方需要再多打一次 API 才能讓遊戲往下走。
  //
  // 2. 過渡期間結束後：跟以前一樣，倒數 COUNTDOWN_SEC 秒、時間到呼叫 play()，
  //    晚進這一題的玩家（含剛結束過渡期間的所有玩家）用 elapsedSec 接續播放而非從頭開始。
  //
  // 換題（currentRoundIndex 改變）或答案公布（lastRevealedAt 改變）時整個重置。
  useEffect(() => {
    playedRoundRef.current = -1;
    audioController?.stop();

    const roundStartAtMs = room.roundStartedAt ? new Date(room.roundStartedAt).getTime() : null;
    const lastRevealedAtMs = room.lastRevealedAt ? new Date(room.lastRevealedAt).getTime() : null;
    const audioStartAtMs = roundStartAtMs !== null ? roundStartAtMs + COUNTDOWN_SEC * 1000 : null;

    const tick = () => {
      // 用校正過的估計伺服器時間，而不是裝置自己的 Date.now()——理由見 lib/client/serverClock.ts，
      // 否則系統時鐘不準的裝置，倒數／換題時機會固定跑掉（不是網路延遲那種浮動誤差，
      // 是每次都固定差同樣一截，因為裝置時鐘本身就跟真實時間差了那麼多）。
      const now = estimateServerNow();

      if (lastRevealedAtMs !== null && now - lastRevealedAtMs < REVEAL_DISPLAY_MS) {
        setShowingLastReveal(true);
        setCountdown(0);
        return;
      }
      setShowingLastReveal(false);

      if (audioStartAtMs === null) {
        setCountdown(0);
        return;
      }
      const msLeft = audioStartAtMs - now;
      if (msLeft > 0) {
        setCountdown(Math.ceil(msLeft / 1000));
        return;
      }
      setCountdown(0);
      if (playedRoundRef.current === room.currentRoundIndex) return;
      // 還沒解鎖過就先不要嘗試播放——會被瀏覽器悄悄擋下、狀態卡在 loading，玩家還搞不懂
      // 為什麼沒聲音。等玩家點了下方的「點一下繼續播放」按鈕、真正解鎖後，
      // unlockRetryToken 改變會讓這個 effect 重新跑一次，那時候才真正呼叫 play()。
      if (needsUnlock) return;
      playedRoundRef.current = room.currentRoundIndex;

      if (!audioController || !room.currentSongSource || !room.currentSongPlaybackId || !room.currentQuestion) return;
      if (room.currentQuestion.renderType === 'text-lyric') return;

      // elapsedSec：晚進這一題的玩家（例如中途重新整理頁面）從目前應該播到的秒數接續播放，
      // 而不是從頭開始，盡量跟其他玩家同步；沒有上限時長，會一路播到歌曲本身結束為止。
      const elapsedSec = Math.max(0, -msLeft / 1000);
      if (room.currentSongSource === 'apple') {
        // Apple 試聽片段一律從片段開頭起算（已知限制見 lib/audio/resolvePlaybackTarget.ts），
        // 晚進的玩家用 elapsedSec 直接當作片段內的秒數接續播放，不套用 clipStartSec
        // （那是相對於完整歌曲算的，對只有 30 秒的試聽片段沒有意義）。
        audioController.play('apple', room.currentSongPlaybackId, elapsedSec);
      } else if (room.currentQuestion.renderType === 'audio-intro') {
        audioController.play('youtube', room.currentSongPlaybackId, elapsedSec);
      } else if (room.currentQuestion.renderType === 'audio-clip') {
        const clipStart = room.currentQuestion.clipStartSec ?? 0;
        audioController.play('youtube', room.currentSongPlaybackId, clipStart + elapsedSec);
      }
    };

    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioController, room.currentRoundIndex, room.roundStartedAt, room.lastRevealedAt, needsUnlock, unlockRetryToken]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', width: '100%', maxWidth: '480px' }}>
      <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
        第 {room.currentRoundIndex + 1} / {room.roundCount} 題
      </span>

      {needsUnlock && (
        <button
          onClick={handleTapToUnlock}
          className="btn btn-primary btn-block"
          style={{ maxWidth: '320px' }}
        >
          🔊 點一下繼續播放音樂
        </button>
      )}

      {/*
        這個區塊在「倒數中」「播放中」「已公布答案」幾種狀態下，內容高度差異很大
        （純數字倒數 vs 音訊播放動畫+投票按鈕 vs 公布答案文字），如果不固定高度，
        下面的計分板、聊天室會隨著換狀態上下跳動，體驗很差。用固定的 minHeight
        把這個區塊的高度鎖住，內容用 justifyContent 置中，不管哪種狀態下面的
        元素位置都不會跟著移動。這個高度是抓「播放中＋投票按鈕＋投票提示」這個
        最高的組合再留一點餘裕，如果之後又加了新的狀態內容，記得回來調整這個數字。
      */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          minHeight: '360px',
          width: '100%',
        }}
      >
        {showingLastReveal ? (
          <>
            <p style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '1.4rem', textAlign: 'center' }}>
              {room.lastRevealedTitle}
              {room.lastRevealedArtist && (
                <span style={{ color: 'var(--ink-dim)', fontWeight: 400, fontSize: '1rem' }}>
                  {' '}– {room.lastRevealedArtist}
                </span>
              )}
            </p>
            {room.lastRevealedThemeLabels.length > 0 && (
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
                主題：{room.lastRevealedThemeLabels.join('、')}
              </p>
            )}
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>即將進入下一題…</p>
          </>
        ) : (
          <>
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

            {countdown === 0 && room.answerMode === 'choice' && room.currentChoices.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '10px',
                  width: '100%',
                  maxWidth: '420px',
                }}
              >
                {room.currentChoices.map((choice) => {
                  const feedback =
                    choiceFeedback?.roundIndex === room.currentRoundIndex && choiceFeedback.songId === choice.songId
                      ? choiceFeedback
                      : null;
                  const feedbackClass = feedback ? (feedback.correct ? 'is-correct' : 'is-wrong') : '';
                  return (
                    <button
                      key={choice.songId}
                      onClick={() => handleAnswerChoice(choice.songId)}
                      disabled={answeringChoice}
                      className={`choice-btn ${feedbackClass}`}
                    >
                      {choice.title}
                    </button>
                  );
                })}
              </div>
            )}

            {countdown === 0 && room.answerMode === 'text' && (
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', textAlign: 'center' }}>
                在下方聊天室打歌名搶答，答對自動得分並公布答案
              </p>
            )}

            {countdown === 0 && (
              <button
                onClick={handleVoteSkip}
                disabled={voting}
                className={`btn btn-toggle ${room.skipVotePlayerIds.includes(playerId) ? 'is-active' : ''}`}
                style={{ borderRadius: '999px', padding: '8px 20px' }}
              >
                {voting
                  ? '處理中…'
                  : room.skipVotePlayerIds.includes(playerId)
                    ? `已投票跳題（${room.skipVotePlayerIds.length}/${room.players.length}）· 點我收回`
                    : `投票跳題（${room.skipVotePlayerIds.length}/${room.players.length}）`}
              </button>
            )}

            {countdown === 0 && room.skipVotePlayerIds.length > 0 && (
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', textAlign: 'center' }}>
                全員都投票跳題，這題就會流局並直接公布答案
              </p>
            )}
          </>
        )}
      </div>

      <ScoreList players={room.players} />

      {isHost && (
        <button onClick={handleEnd} className="btn btn-danger btn-sm">
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
        <button onClick={handleRestart} disabled={restarting} className="btn btn-primary">
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
  answerMode,
}: {
  joinCode: string;
  playerId: string;
  messages: RoomMessage[];
  onMessageSent: (message: RoomMessage) => void;
  answerMode: AnswerMode;
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
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
            {answerMode === 'choice' ? '聊天室：純聊天，搶答請點上面的選項' : '聊天室：搶答也在這裡打字'}
          </p>
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
          className="field"
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={sending} className="btn btn-primary">
          送出
        </button>
      </form>
    </div>
  );
}
