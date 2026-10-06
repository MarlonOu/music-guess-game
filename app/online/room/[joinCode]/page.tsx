'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { RoomState, RoomMessage, AnswerMode, RoomChoice } from '../../../../lib/types/room';
import type { GameMode } from '../../../../lib/types/match';
import type { Artist, Theme } from '../../../../lib/types/theme';
import { roomRepository } from '../../../../lib/repository/roomRepository';
import { songRepository } from '../../../../lib/repository/songRepository';
import { AudioController, type AudioPlaybackStatus } from '../../../../lib/audio/audioController';
import { getGlobalAudioController } from '../../../../lib/audio/globalAudioController';
import { estimateServerNow } from '../../../../lib/client/serverClock';
import { COUNTDOWN_SEC, REVEAL_DISPLAY_MS } from '../../../../lib/constants/roomTiming';
import { WRONG_ANSWER_LOCKOUT_MS } from '../../../../lib/constants/choiceMode';
import { RankBadge, PlayerIdentity, playerDotColor } from '../../../../components/game/PlayerBadges';
import { ArtistFilter } from '../../../../components/filter/ArtistFilter';
import { ThemeFilter } from '../../../../components/filter/ThemeFilter';
import { AnswerSticker } from '../../../../components/game/AnswerSticker';
import { StageDisc } from '../../../../components/game/StageDisc';
import { SELECTABLE_GAME_MODES } from '../../../../lib/constants/gameMode';

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
  const leavingRef = useRef(false);
  // 剛加入房間的時間：加入當下若有一次加入前就送出的輪詢晚回來，會把名單蓋回沒有自己的舊資料，
  // 這段短暫時間內不做自我修復，等下一次輪詢拿到新名單即可。
  const joinedAtRef = useRef(0);
  useEffect(() => {
    if (!room || !playerId) return;
    if (room.players.some((p) => p.id === playerId)) return;
    if (rejoiningRef.current || leavingRef.current) return;
    if (Date.now() - joinedAtRef.current < 3000) return;

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
    // 先標記「正在離開」：離開後下一次輪詢會發現自己不在名單裡，自我修復機制會誤以為是異常
    // 而用同樣暱稱自動重新加入，等於把剛離開的人又塞回房間（變成佔名字的幽靈玩家，
    // 之後本人想用原暱稱重新加入還會被擋）。
    leavingRef.current = true;
    if (playerId) {
      await roomRepository.leave(joinCode, playerId);
    }
    sessionStorage.removeItem(`room-player-${joinCode}`);
    sessionStorage.removeItem(`room-player-name-${joinCode}`);
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
    return (
      <JoinPrompt
        joinCode={joinCode}
        onJoined={(id, joinedRoom) => {
          // 直接套用加入後伺服器回傳的最新房間狀態：否則畫面上還是加入前輪詢到的舊資料
          // （名單裡沒有自己），下面的自我修復 effect 會誤判「自己被移出房間」，
          // 把剛存的身分清掉、畫面閃回暱稱輸入表單，同時房間裡卻已經有這位玩家。
          joinedAtRef.current = Date.now();
          setRoom(joinedRoom);
          setPlayerId(id);
        }}
      />
    );
  }

  if (!room) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--ink-dim)' }}>連線中…</p>
      </main>
    );
  }

  const isHost = room.hostPlayerId === playerId;
  const hasChat = room.answerMode !== 'choice';
  // 選擇題模式結算時右欄沒有東西可放（沒有聊天室、計分板已在左欄），改成單欄置中
  const isSingle = !hasChat && room.status === 'finished';

  return (
    <main className="room-page">
      <header className="room-head">
        <div className="room-title">
          <span className="room-eyebrow">Online</span>
          <h1>線上模式</h1>
        </div>
        <RoomCodeMenu joinCode={room.joinCode} />
      </header>

      <div className={`room-grid${isSingle ? ' is-single' : ''}`}>
        <section className="room-panel room-left">
          <AnimatePresence mode="wait">
            <motion.div
              key={room.status}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              style={{ width: '100%', display: 'flex', justifyContent: 'center', flexShrink: 0 }}
            >
              {room.status === 'lobby' && (
                <LobbyView room={room} playerId={playerId} isHost={isHost} onError={setError} onRoomUpdate={setRoom} />
              )}
              {room.status === 'playing' && (
                <PlayingView room={room} playerId={playerId} isHost={isHost} onError={setError} onRoomUpdate={setRoom} />
              )}
              {room.status === 'finished' && (
                <FinishedView room={room} playerId={playerId} isHost={isHost} onError={setError} onRoomUpdate={setRoom} />
              )}
            </motion.div>
          </AnimatePresence>
        </section>

        {!isSingle && (
          <aside className="room-right">
            {room.status === 'playing' && (
              <section className={`room-panel score-panel${hasChat ? '' : ' is-grow'}`}>
                <div className="room-panel-head">
                  <span>計分板</span>
                  <b>{room.players.length} 人</b>
                </div>
                <ScoreList players={room.players} />
              </section>
            )}

            {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}

            {/* 選擇題搶答模式不需要聊天室——答題完全透過選項按鈕，聊天室原本只是被動保留給
                純聊天用途，但在畫面寸土寸金的手機上多一塊沒有實際功能的區塊反而是干擾，
                乾脆整個不顯示，畫面更乾淨。打字搶答模式維持不變（聊天室本身就是搶答的管道）。 */}
            {hasChat && (
              <ChatBox joinCode={joinCode} playerId={playerId} messages={messages} onMessageSent={handleMessageSent} answerMode={room.answerMode} />
            )}

            <button onClick={handleLeaveClick} className="btn-text room-leave">
              離開房間
            </button>
          </aside>
        )}
      </div>

      {isSingle && (
        <>
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}
          <button onClick={handleLeaveClick} className="btn-text room-leave" style={{ width: '100%', maxWidth: '560px' }}>
            離開房間
          </button>
        </>
      )}
    </main>
  );
}

/** 房號膠囊：點「複製」展開選單，選擇複製房號代碼或加入連結 */
function RoomCodeMenu({ joinCode }: { joinCode: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 非 https 或權限被拒時，退回舊式 execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  async function handleCopy(kind: 'code' | 'link') {
    const text = kind === 'code' ? joinCode : `${window.location.origin}/online/room/${joinCode}`;
    const ok = await copyText(text);
    setOpen(false);
    if (!ok) return;
    setCopied(kind);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="room-code-wrap" ref={rootRef}>
      <div className={`room-code${copied ? ' is-copied' : ''}`}>
        <span className="room-code-label">房號</span>
        <span className="room-code-value">{joinCode}</span>
        <button
          type="button"
          className="room-code-copy"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {copied ? (copied === 'code' ? '已複製代碼' : '已複製連結') : '複製'}
          {!copied && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s ease' }}>
              <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
      {open && (
        <div className="room-code-menu" role="menu">
          <button type="button" role="menuitem" className="room-code-item" onClick={() => handleCopy('code')} autoFocus>
            <span className="room-code-item-title">複製房號代碼</span>
            <span className="room-code-item-sub">{joinCode}</span>
          </button>
          <button type="button" role="menuitem" className="room-code-item" onClick={() => handleCopy('link')}>
            <span className="room-code-item-title">複製加入連結</span>
            <span className="room-code-item-sub">朋友點開就能直接加入</span>
          </button>
        </div>
      )}
    </div>
  );
}

function JoinPrompt({ joinCode, onJoined }: { joinCode: string; onJoined: (playerId: string, room: RoomState) => void }) {
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
    // 真正的使用者手勢（表單送出），一定要先等 unlock() 真正跑完才能繼續——理由跟速通模式
    // 修過的那個 bug完全一樣：這個表單支援中途加入一場已經在進行中的比賽，加入後可能立刻
    // 就要播放當下這一題的音樂，如果不等 unlock() 跑完就讓後面的流程搶著用同一個播放器，
    // 會導致解鎖用的測試影片沒被正確消音、玩家聽到不該聽到的東西，實際歌曲反而放不出來。
    await getGlobalAudioController().unlock();
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
    onJoined(result.data.playerId, result.data.room);
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
    // QR Code 的深淺兩色故意不用函式庫預設的純黑／純白——預設配色是一塊硬生生的白色
    // 方塊，插在整站深色介面裡會很突兀，像是從別的網站貼過來的圖片。改用跟整站同一組
    // 色票（金色深色模組、--bg-raised 當底色），對比度依然很高（換算下來超過 10:1，
    // 遠超過 QR Code 可靠掃描所需的對比），但視覺上屬於這個介面自己的東西，不是外來物。
    QRCode.toDataURL(joinUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#e8b93f', light: '#17181c' },
    })
      .then(setDataUrl)
      .catch((err) => setError(err instanceof Error ? err.message : '產生 QR Code 失敗'));
  }, [open, joinCode]);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`btn btn-toggle btn-sm ${open ? 'is-active' : ''}`}
        style={{ alignSelf: 'flex-start', borderRadius: '999px', display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        {/* 自畫的 QR 圖示取代 📷 emoji，理由跟整站其餘圖示一致 */}
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
          <rect x="12" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
          <rect x="2" y="12" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
          <rect x="12.5" y="12.5" width="2" height="2" fill="currentColor" />
          <rect x="16" y="12.5" width="2" height="2" fill="currentColor" />
          <rect x="12.5" y="16" width="2" height="2" fill="currentColor" />
          <rect x="16" y="16" width="2" height="2" fill="currentColor" />
        </svg>
        {open ? '收合 QR Code' : '顯示 QR Code 讓朋友掃描加入'}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        // 邀請卡片：QR Code＋房號放在同一張白色系卡片裡，用虛線分隔，模擬「票根」的
        // 視覺語言——這是一個音樂派對遊戲，邀請朋友加入這個動作本身帶著社交、慶祝的
        // 性質，值得比「純功能性的 QR Code 圖片」更講究一點的呈現方式。
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: 'fit-content',
            borderRadius: '16px',
            border: '1px solid var(--groove)',
            background: 'var(--bg-raised)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '18px 18px 14px' }}>
            {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{error}</p>}
            {dataUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- data URL 是本機即時產生的圖片，不是需要 Next Image 最佳化的外部/靜態資源
              <img src={dataUrl} alt={`掃描加入房間 ${joinCode}`} width={220} height={220} style={{ display: 'block', borderRadius: '8px' }} />
            )}
          </div>
          <div
            style={{
              width: '100%',
              borderTop: '1px dashed var(--groove)',
              padding: '12px 18px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', letterSpacing: '0.15em', color: 'var(--accent)' }}>
              {joinCode}
            </span>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.78rem' }}>掃描後自動帶入房號，只需要再輸入暱稱</span>
          </div>
        </motion.div>
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

  const modeLabel = SELECTABLE_GAME_MODES.find((m) => m.code === room.mode)?.label ?? room.mode;
  const filterSummary =
    room.artistFilterIds.length > 0
      ? `歌手篩選：${room.artistFilterIds.map((id) => artists.find((a) => a.id === id)?.name ?? id).join('、')}`
      : room.themeFilterIds.length > 0
        ? `主題篩選：${room.themeFilterIds.map((id) => themes.find((t) => t.id === id)?.name ?? id).join('、')}`
        : '使用全部題庫';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '26px', width: '100%', maxWidth: '480px' }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>房間內玩家（{room.players.length}）</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {/* 用 AnimatePresence 讓新玩家加入時有一個小小的彈入動畫，不是瞬間憑空冒出來——
              準備室等人進房間本來就是這個畫面最有「現場感」的時刻，有人剛加入時螢幕上
              冒出一個新名牌，值得一個小回饋，而不是無聲無息地多一個項目。姓名前面的
              色點（PlayerIdentity，跟計分畫面同一套元件）讓玩家在準備室就先認好「這個
              顏色是誰」，帶進正式計分畫面時能直接沿用這個印象。 */}
          <AnimatePresence initial={false}>
            {room.players.map((p) => (
              <motion.span
                key={p.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  borderRadius: '999px',
                  border: '1px solid var(--groove)',
                  background: 'var(--bg-raised)',
                  fontSize: '0.9rem',
                }}
              >
                <PlayerIdentity id={p.id} name={p.displayName} />
                {/* 自畫的皇冠線條圖示取代 👑 emoji，理由跟整站其餘圖示一致——emoji 在
                    不同裝置上粗細、顏色、甚至配色都不一樣，跟自己畫的線條圖示語言放在
                    一起會顯得突兀。 */}
                {p.id === room.hostPlayerId && (
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-label="房主" role="img">
                    <path
                      d="M3 15h14l1-8-4.5 3L10 5 6.5 10 2 7l1 8Z"
                      stroke="var(--accent)"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </section>

      <QrJoinSection joinCode={room.joinCode} />

      {isHost ? (
        <>
          {/* 跟單機模式的比賽設定表單（components/match/MatchSetupForm.tsx）用同一套
              「選項附一行說明」的呈現方式（.mode-option，見 app/globals.css），玩家不管
              從哪個模式進來設定玩法，看到的都是同一套介面語言，不會因為是線上模式
              就突然變成另一種風格的選單。 */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>模式</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {SELECTABLE_GAME_MODES.map((m) => (
                <button
                  key={m.code}
                  type="button"
                  onClick={() => updateSettings({ mode: m.code })}
                  className={`mode-option ${room.mode === m.code ? 'is-active' : ''}`}
                  aria-pressed={room.mode === m.code}
                >
                  <span className="mode-option-dot" aria-hidden="true" />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: 600 }}>{m.label}</span>
                    <span style={{ color: 'var(--ink-dim)', fontSize: '0.82rem' }}>{m.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* 跟上面模式選單同一套 .mode-option 樣式——說明文字直接放進各自的選項裡，
              不再是「選完之後才在下面另外冒出一行說明」，玩家選之前就能看到兩種搶答
              方式的差異，不用先選了才知道自己選的是什麼。 */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <span style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>搶答方式</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                onClick={() => updateSettings({ answerMode: 'text' })}
                className={`mode-option ${room.answerMode === 'text' ? 'is-active' : ''}`}
                aria-pressed={room.answerMode === 'text'}
              >
                <span className="mode-option-dot" aria-hidden="true" />
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: 600 }}>打字搶答</span>
                  <span style={{ color: 'var(--ink-dim)', fontSize: '0.82rem' }}>在聊天室打歌名搶答，第一個答對的人得分</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => updateSettings({ answerMode: 'choice' })}
                className={`mode-option ${room.answerMode === 'choice' ? 'is-active' : ''}`}
                aria-pressed={room.answerMode === 'choice'}
              >
                <span className="mode-option-dot" aria-hidden="true" />
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: 600 }}>選擇題搶答</span>
                  <span style={{ color: 'var(--ink-dim)', fontSize: '0.82rem' }}>
                    顯示幾個選項（含干擾選項），第一個點對的人得分，比打字更公平、更防偷查答案
                  </span>
                </span>
              </button>
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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

/**
 * 選擇題搶答的選項按鈕，答錯的鎖定狀態刻意封裝在這個元件內部（見 PlayingView 裡
 * handleAnswerChoice 的說明：換題時用 key={room.currentRoundIndex} 讓這個元件整個
 * 重新掛載，內部的 locked／answering 狀態自然歸零，不需要額外寫一個 effect 手動清除）。
 */
function ChoiceButtons({
  choices,
  choiceFeedback,
  currentRoundIndex,
  onAnswer,
}: {
  choices: RoomChoice[];
  choiceFeedback: { roundIndex: number; songId: string; correct: boolean } | null;
  currentRoundIndex: number;
  onAnswer: (songId: string) => Promise<boolean>;
}) {
  const [locked, setLocked] = useState(false);
  const [answering, setAnswering] = useState(false);

  async function handleClick(songId: string) {
    if (locked || answering) return;
    setAnswering(true);
    const correct = await onAnswer(songId);
    setAnswering(false);
    if (!correct) {
      // 逞罰機制：答錯鎖定選項按鈕一段時間，不能立刻再選，答錯要付出等待的代價，
      // 不然選擇題只有 3~4 個選項，亂點試出正解的成本低到跟沒有鑑別度一樣。
      setLocked(true);
      setTimeout(() => setLocked(false), WRONG_ANSWER_LOCKOUT_MS);
    }
  }

  return (
    <>
      {/* 固定保留這段文字的高度、用 visibility 切換可見度，不要條件式掛載/卸載，
          否則下面的選項按鈕會跟著上下跳動。 */}
      <p
        style={{
          color: 'var(--error)',
          fontSize: '0.85rem',
          visibility: locked ? 'visible' : 'hidden',
          margin: 0,
        }}
      >
        答錯了，等 {WRONG_ANSWER_LOCKOUT_MS / 1000} 秒才能再選…
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '10px',
          width: '100%',
          maxWidth: '420px',
        }}
      >
        {choices.map((choice) => {
          const feedback =
            choiceFeedback?.roundIndex === currentRoundIndex && choiceFeedback.songId === choice.songId
              ? choiceFeedback
              : null;
          const feedbackClass = feedback ? (feedback.correct ? 'is-correct' : 'is-wrong') : '';
          return (
            <motion.button
              key={choice.songId}
              onClick={() => handleClick(choice.songId)}
              disabled={answering || locked}
              className={`choice-btn ${feedbackClass}`}
              whileTap={{ scale: 0.95 }}
            >
              <span className="choice-btn-text" title={choice.title}>{choice.title}</span>
              {/* 答對／答錯的彈跳、搖晃動畫交給 CSS（.choice-btn.is-correct／.is-wrong，
                  見 app/globals.css），這裡不再額外用 Framer Motion 的 animate 疊加一次
                  幾乎一樣的縮放效果——同一個按鈕同時被兩套動畫系統控制同一個屬性，
                  容易出現時序對不齊、互相打架的狀況，統一交給其中一套處理就好。
                  圖示徽章不只是裝飾：色盲/色弱的玩家不能只靠顏色判斷這題對不對，
                  打勾／打叉的形狀才是真正可靠的判斷依據。 */}
              {feedback && (
                <span className={`choice-btn-badge ${feedback.correct ? 'is-correct' : 'is-wrong'}`} aria-hidden="true">
                  {feedback.correct ? (
                    <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.5 5 9l4.5-5.5" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M3 3l6 6M9 3l-6 6" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </>
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
  // 播放完畢／失敗動畫（見 StageDisc）。狀態在每題開始時會被 stop() 重置為 'idle'。
  const [audioStatus, setAudioStatus] = useState<AudioPlaybackStatus>('idle');
  const playedRoundRef = useRef<number>(-1);
  const [voting, setVoting] = useState(false);
  // 選擇題搶答模式：記錄「目前這輪我點過哪個、對不對」，讓按鈕能立刻顯示視覺回饋
  // （綠色代表點對、紅色代表點錯），不用等下一次輪詢才看得到反應。換題時要重置。
  const [choiceFeedback, setChoiceFeedback] = useState<{ roundIndex: number; songId: string; correct: boolean } | null>(
    null
  );
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

  // 回傳這次是否答對，交給 ChoiceButtons 自己決定要不要進入答錯鎖定——鎖定狀態刻意放在
  // ChoiceButtons 元件內部（用 key={room.currentRoundIndex} 讓它每次換題都整個重新掛載），
  // 而不是放在這裡用 effect 依 room.currentRoundIndex 手動重置：換題時「整個元件重新掛載、
  // 內部狀態自然歸零」是 React 官方建議的做法，比起在 effect 裡呼叫 setState 手動清除
  // 上一題殘留的狀態更直接，也不會有「換題換一半、計時器還沒清乾淨」這類時序問題。
  async function handleAnswerChoice(songId: string): Promise<boolean> {
    const result = await roomRepository.answerChoice(room.joinCode, playerId, songId);
    if (!result.ok || !result.data) {
      onError(result.error ?? '搶答失敗');
      return true; // 呼叫失敗不算答錯，不應該觸發鎖定
    }
    setChoiceFeedback({ roundIndex: room.currentRoundIndex, songId, correct: result.data.correct });
    onRoomUpdate(result.data.room);
    return result.data.correct;
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
      <div className="room-round">
        <span className="room-round-count">
          {String(room.currentRoundIndex + 1).padStart(2, '0')}
          <span> / {String(room.roundCount).padStart(2, '0')}</span>
        </span>
        <div className="round-pips" aria-hidden="true">
          {Array.from({ length: room.roundCount }, (_, i) => (
            <i key={i} className={i < room.currentRoundIndex ? 'is-done' : i === room.currentRoundIndex ? 'is-now' : ''} />
          ))}
        </div>
        {isHost ? (
          <button onClick={handleEnd} className="room-end btn-text">
            提前結束
          </button>
        ) : (
          <span style={{ width: '56px' }} />
        )}
      </div>

      {needsUnlock && (
        <button
          onClick={handleTapToUnlock}
          className="btn btn-primary btn-block"
          style={{ maxWidth: '320px' }}
        >
          點一下繼續播放音樂
        </button>
      )}

      {/*
        版面固定成兩段：上段是唱盤舞台（位置永遠不變，貼紙內容隨狀態換成倒數／問號／答案），
        下段是固定高度的操作區（選項、提示、跳題投票）。不管房間狀態怎麼切換
        （倒數、選擇題、打字搶答、公布答案），唱盤與其下方元件的座標都不會移動。
      */}
      {(() => {
        const isLyric = countdown === 0 && room.currentQuestion?.renderType === 'text-lyric';
        const isAudio =
          room.currentQuestion?.renderType === 'audio-intro' || room.currentQuestion?.renderType === 'audio-clip';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', width: '100%' }}>
            <div className="stage-slot">
              {showingLastReveal ? (
                <StageDisc bare>
                  <AnswerSticker
                    key={room.lastRevealedAt ?? 'answer'}
                    title={room.lastRevealedTitle ?? ''}
                    artist={room.lastRevealedArtist}
                    coverUrl={room.lastRevealedCoverUrl}
                  />
                </StageDisc>
              ) : countdown > 0 ? (
                <StageDisc>
                  <span
                    key={countdown}
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      fontSize: '3.2rem',
                      lineHeight: 1,
                      animation: 'choice-badge-pop 0.35s cubic-bezier(0.34,1.56,0.64,1)',
                    }}
                  >
                    {countdown}
                  </span>
                </StageDisc>
              ) : isLyric ? (
                <StageDisc>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.4 }}>
                    {room.currentQuestion?.lyricLineText || '（此題無可用歌詞）'}
                  </span>
                </StageDisc>
              ) : (
                <StageDisc status={isAudio ? audioStatus : 'idle'}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '2.6rem', lineHeight: 1 }}>?</span>
                </StageDisc>
              )}
            </div>

            <div className="stage-dock">
              <div className={`stage-dock-main${room.answerMode === 'text' ? ' is-text' : room.answerMode === 'choice' ? ' is-choice' : ''}`}>
                {showingLastReveal ? (
                  <>
                    {room.lastRevealedThemeLabels.length > 0 && (
                      <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
                        主題：{room.lastRevealedThemeLabels.join('、')}
                      </p>
                    )}
                    <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>即將進入下一題…</p>
                  </>
                ) : (
                  <>
                    {countdown === 0 && room.answerMode === 'choice' && room.currentChoices.length > 0 && (
                      <ChoiceButtons
                        key={room.currentRoundIndex}
                        choices={room.currentChoices}
                        choiceFeedback={choiceFeedback}
                        currentRoundIndex={room.currentRoundIndex}
                        onAnswer={handleAnswerChoice}
                      />
                    )}
                    {countdown === 0 && room.answerMode === 'text' && (
                      <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', textAlign: 'center' }}>
                        在下方聊天室打歌名搶答，答對自動得分並公布答案
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="stage-dock-foot" style={{ visibility: !showingLastReveal && countdown === 0 ? 'visible' : 'hidden' }}>
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
                <p
                  style={{
                    color: 'var(--ink-dim)',
                    fontSize: '0.8rem',
                    textAlign: 'center',
                    visibility: room.skipVotePlayerIds.length > 0 ? 'visible' : 'hidden',
                  }}
                >
                  全員都投票跳題，這題就會流局並直接公布答案
                </p>
              </div>
            </div>
          </div>
        );
      })()}

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

  const topScore = Math.max(0, ...room.players.map((p) => p.score));
  const winners = topScore > 0 ? room.players.filter((p) => p.score === topScore) : [];
  const winnerText = winners.map((p) => p.displayName).join('、');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', width: '100%', maxWidth: '420px' }}>
      <div className="result-winner">
        <span className="room-eyebrow">比賽結束</span>
      </div>
      <StageDisc answer size="clamp(200px, min(56vw, 32dvh), 280px)">
        {winners.length > 0 ? (
          <>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.2em', opacity: 0.7 }}>
              {winners.length > 1 ? 'WINNERS' : 'WINNER'}
            </span>
            <span className="stage-answer-title" style={{ fontSize: winnerText.length > 8 ? '0.9rem' : '1.1rem' }}>
              {winnerText}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.4rem', lineHeight: 1 }}>{topScore}</span>
          </>
        ) : (
          <span className="stage-answer-title">無人得分</span>
        )}
      </StageDisc>
      <ScoreList players={room.players} showRanking />
      {isHost ? (
        <button onClick={handleRestart} disabled={restarting} className="btn btn-primary btn-block">
          {restarting ? '處理中…' : '返回房間再玩一輪'}
        </button>
      ) : (
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>等待房主開啟下一輪…</p>
      )}
    </div>
  );
}

/**
 * showRanking：區分「比賽進行中、順帶看一下目前分數」跟「比賽結束、正式公布名次」
 * 這兩種不同場合，用間距跟字級的密度差異表現，不是改變底層邏輯——名次徽章跟玩家
 * 識別標籤（RankBadge／PlayerIdentity，跟單機模式共用同一份，見 PlayerBadges.tsx）
 * 在兩種場合都會顯示，維持「同一套視覺語言貫穿整場遊戲」。
 */
function ScoreList({ players, showRanking }: { players: RoomState['players']; showRanking?: boolean }) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const topScore = ranked[0]?.score ?? 0;
  return (
    <ul className={showRanking ? undefined : 'score-list'} style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {ranked.map((p, i) => {
        const isTop = p.score === topScore && topScore > 0;
        return (
          <li
            key={p.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: showRanking ? '14px 18px' : '10px 14px',
              borderRadius: showRanking ? '14px' : '10px',
              border: showRanking && isTop ? '1px solid var(--accent)' : '1px solid var(--groove)',
              background: showRanking && isTop ? 'var(--bg-raised)' : 'transparent',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
              <RankBadge rank={i + 1} />
              <PlayerIdentity id={p.id} name={p.displayName} />
            </span>
            <span
              style={{
                flexShrink: 0,
                minWidth: '32px',
                textAlign: 'right',
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
    <section className="room-panel chat-panel">
      <div className="room-panel-head">
        <span>聊天室</span>
        <b>{answerMode === 'choice' ? '純聊天' : '打歌名搶答'}</b>
      </div>
      <div
        ref={listRef}
        className="chat-list"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          // 用 clamp() 算出一個跟著視窗高度縮放的高度（有下限也有上限），而不是靠 flex
          // 去搶父層的剩餘空間——上一版用 flex:1 撐滿剩餘空間的做法，遇到上方內容本身就很高
          // （準備室的篩選清單、遊戲中玩家名單較長）時，會把聊天室硬壓縮到比自己內容還小，
          // 內容就會溢出、跟下面的「離開房間」重疊，版面整個跑掉。clamp() 是聊天室自己算好
          // 的高度，不依賴、也不會被兄弟元素的高度擠壓，不會有這個問題：
          // 最小 140px（大約放得下 3~4 行訊息＋輸入框，太矮會太難用）、
          // 最大 260px（避免大螢幕上這一塊佔比過大）、
          // 中間用視窗高度的 22% 動態調整，螢幕愈高聊天室就跟著愈高，螢幕矮的手機也不會被撐爆。
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
            {answerMode === 'choice' ? '搶答請點左側選項，這裡只用來聊天' : '搶答也在這裡打字'}
          </p>
        )}
        {messages.map((m) => (
          <p
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '6px',
              fontSize: '0.9rem',
              color: m.isCorrectAnswer ? 'var(--success)' : 'var(--ink)',
              fontWeight: m.isCorrectAnswer ? 600 : 400,
            }}
          >
            {/* 發言者前面補一個色點，跟計分畫面、準備室玩家名單用同一套顏色（playerDotColor，
                依玩家 id 算出來）——聊天室訊息一多，用顏色比純文字更快掃出「這幾句是同一個
                人說的」，不用每行都重新讀一次名字。 */}
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: playerDotColor(m.playerId),
              }}
            />
            <span>
              <span style={{ color: 'var(--ink-dim)' }}>{m.displayName}：</span>
              {m.text}
              {m.isCorrectAnswer && ' ✓ 答對'}
            </span>
          </p>
        ))}
      </div>
      <form onSubmit={handleSend} style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="打字聊天／搶答歌名"
          className="field"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" disabled={sending} className="btn btn-primary" style={{ flexShrink: 0 }}>
          送出
        </button>
      </form>
    </section>
  );
}
