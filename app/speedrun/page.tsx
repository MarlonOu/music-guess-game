'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { AudioController, type AudioPlaybackStatus } from '../../lib/audio/audioController';
import { speedrunRepository } from '../../lib/repository/speedrunRepository';
import { estimateServerNow } from '../../lib/client/serverClock';
import type { SpeedrunQuestion, SpeedrunSubmitResponse, SpeedrunLeaderboardEntry } from '../../lib/types/speedrun';
import { SPEEDRUN_TRANSITION_SEC, SPEEDRUN_AUDIO_WAIT_CAP_MS } from '../../lib/constants/speedrun';
import { WRONG_ANSWER_LOCKOUT_MS } from '../../lib/constants/choiceMode';

const QUESTION_COUNT = 10;
/** 碼表畫面更新頻率；不需要真的到毫秒等級的更新頻率，肉眼看起來夠平滑即可，
 *  太頻繁只會白白增加不必要的重新渲染 */
const STOPWATCH_TICK_MS = 33;

type Phase = 'intro' | 'loading' | 'playing' | 'transition' | 'submitting' | 'results';

/** 毫秒數轉成「分:秒.毫秒」格式，例如 83421 → "01:23.421" */
function formatStopwatch(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export default function SpeedrunPage() {
  const playerContainerId = useId().replace(/:/g, '-');
  const audioControllerRef = useRef<AudioController | null>(null);
  const raceStartRef = useRef<number | null>(null);
  // 碼表只計「真正在播放音樂」的時間：緩衝畫面（答對後、下一題開始前）音樂是停止的，
  // 不該算進去。pausedMsRef 累積目前為止所有緩衝畫面耗掉的時間，顯示碼表時從原始經過時間
  // 裡扣掉；transitionStartedAtRef 記錄「這次緩衝畫面」開始的時間點，緩衝結束時才真正
  // 累加進 pausedMsRef（理由見下面兩個 effect 的說明）。伺服器那邊用固定公式做一樣的扣除
  // （見 lib/server/speedrunSession.ts），確保畫面顯示的數字跟最終成績兜得起來。
  const pausedMsRef = useRef(0);
  const transitionStartedAtRef = useRef<number | null>(null);
  // 「正在等待這一題的音樂真的開始播放」的時間戳，null 代表目前沒有在等待（音樂已經在播，
  // 或還沒開始要求播放）。跟 pausedMsRef／transitionStartedAtRef 是同一套機制：等待期間
  // 碼表凍結不動，等待結束（偵測到真的開始播放、明確播放錯誤、或等太久逾時，見下面
  // resolveAudioWaitRef 的說明）才把這段等待耗掉的時間累加進 pausedMsRef，這樣裝置網路
  // 不好、音訊緩衝拖延到的時間就不會被算進碼表——伺服器那邊也會做對應的扣除（見
  // lib/server/speedrunSession.ts 的 reportAudioStarted 說明，含防濫用的上限機制），
  // 確保畫面顯示的數字最終跟伺服器認定的成績兜得起來。
  const waitingForAudioStartedAtRef = useRef<number | null>(null);
  // 「等太久還沒開始播放就強制結束等待」的計時器 id，跟伺服器扣除上限用同一個秒數
  // （SPEEDRUN_AUDIO_WAIT_CAP_MS）：這是修正一個實際發生過的 bug——某些歌曲的音源
  // 播放會卡住（沒有明確的錯誤事件、也一直不會進入播放狀態），沒有這個逾時機制的話，
  // 碼表會永遠凍結、也完全聽不到音樂，玩家只能矇對才能繼續，而且矇對之後才發現伺服器
  // 那邊時間其實一直在跑（超過上限的部分沒被扣除），成績被記成很難看的數字。有了逾時，
  // 最壞情況也只會卡住這個上限的秒數就自動恢復，不會無限卡住。
  const waitingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // questionIndex／token 的「隨時最新」鏡像，供 resolveAudioWait 這種可能從舊的 closure
  // （例如很早之前排定的 setTimeout 回呼）被呼叫到的函式讀取，避免讀到過期的值。
  const questionIndexRef = useRef(0);
  // 防止 handleStart() 被重複呼叫的鎖，見該函式內的完整說明。
  const startingRef = useRef(false);
  // 見下方「換題就播放目前這題的音訊」那個 effect、以及 handleStart() 裡的完整說明：
  // 第一題的播放刻意直接留在 handleStart() 自己的呼叫鏈裡（不透過這個 effect 觸發），
  // 這個旗標讓該 effect 知道「這次 phase 變成 playing、questionIndex 變成 0」的這一次
  // 觸發，播放已經在別的地方直接做過了，不需要它自己再重複呼叫一次。
  const skipNextAutoPlayRef = useRef(false);
  const tokenRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>('intro');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [questions, setQuestions] = useState<SpeedrunQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [locked, setLocked] = useState(false);
  // 是否有一個答題請求正在處理中，見 handleChoiceClick 裡的完整說明——這是防止快速連點
  // 造成競態、誤判挑戰逾時的關鍵鎖。
  const [answering, setAnswering] = useState(false);
  const [wrongSongId, setWrongSongId] = useState<string | null>(null);
  const [transitionSecondsLeft, setTransitionSecondsLeft] = useState(SPEEDRUN_TRANSITION_SEC);

  const [results, setResults] = useState<SpeedrunSubmitResponse | null>(null);
  const [introLeaderboard, setIntroLeaderboard] = useState<SpeedrunLeaderboardEntry[] | null>(null);
  const [audioStatus, setAudioStatus] = useState<AudioPlaybackStatus>('idle');
  // 「題目準備中」畫面停留超過一段時間，就顯示一個提示，讓使用者知道可以怎麼做，
  // 不用眼睜睜看著一句「題目準備中…」完全狀況不明——加上前面幫所有請求補的逾時保護後，
  // 最壞情況也會在 15 秒內自動失敗並跳出錯誤訊息，這個提示純粹是讓等待的這段時間
  // 使用者不會覺得毫無頭緒、以為程式當掉了。
  const [loadingTakingAWhile, setLoadingTakingAWhile] = useState(false);

  // 建立這個頁面自己的播放器實例（比照單機模式，不用線上模式那種跨頁面共用的全域實例——
  // 速通模式是單一頁面從頭玩到尾的線性流程，離開頁面播放器就該一併釋放）。
  useEffect(() => {
    const controller = new AudioController(playerContainerId);
    audioControllerRef.current = controller;
    controller.setOnStatusChange(setAudioStatus);
    controller.preload();
    return () => {
      controller.setOnStatusChange(undefined);
      controller.dispose();
      audioControllerRef.current = null;
      if (waitingTimeoutRef.current !== null) {
        clearTimeout(waitingTimeoutRef.current);
        waitingTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 碼表更新：從 raceStartRef 記錄的時間點起算的原始經過時間，扣掉 pausedMsRef 累積的緩衝畫面
  // 時間，只在 'playing' 狀態才更新（緩衝畫面期間音樂沒在播，畫面就該凍結不動，不再跳動）。
  // 還在等待這一題音樂真的開始播放時（waitingForAudioStartedAtRef 不是 null）也一併凍結，
  // 這是回應「裝置網路不好時，該真的確認有在播放音樂才開始讀秒」這個需求的畫面呈現部分。
  //
  // answering 為 true（點下選項、還在等伺服器判定對不對的這段時間）也要凍結——這是修正
  // 一個實際發生過的落差：原本碼表會一直跳到「判定請求」的回應真正回來為止，也就是說
  // 玩家點下正確答案的當下，畫面上的數字其實還會再多跳個零點幾秒到一秒（這次請求本身
  // 的網路來回時間），玩家直覺會以為「我點下去那一刻看到的數字」就是這一題結束的時間，
  // 但伺服器認定的成績是用「收到這次請求的當下」算的，比玩家實際看到畫面凍結時顯示的
  // 數字還要早一點，兩者兜不起來就會覺得「結算成績比剛剛看到的少了快一秒」。凍結的做法
  // 讓畫面上的數字在「點下去的那一刻」就跟玩家的直覺對齊，之後答錯的話會在下面 else
  // 分支自然「追上」正確的經過時間（不會漏算，只是視覺上延後才跳出來）。
  // 用校正過的伺服器時間（見 lib/client/serverClock.ts）而不是裝置自己的 Date.now()，
  // 避免裝置時鐘不準造成顯示跟伺服器實際判定的成績有落差。
  useEffect(() => {
    if (phase !== 'playing') return;
    const tick = () => {
      if (raceStartRef.current !== null && waitingForAudioStartedAtRef.current === null && !answering) {
        setElapsedMs(estimateServerNow() - raceStartRef.current - pausedMsRef.current);
      }
    };
    // 立刻算一次，不要等第一次 interval 觸發才更新——不然剛從緩衝畫面切回來的那一瞬間，
    // 畫面會先停在緩衝畫面凍結時的舊數字，等最多 STOPWATCH_TICK_MS 毫秒後才跳一下，
    // 雖然很短暫但看得出來的話會顯得畫面卡了一下。
    tick();
    const timer = setInterval(tick, STOPWATCH_TICK_MS);
    return () => clearInterval(timer);
  }, [phase, answering]);

  // 換題（或剛進入 playing 狀態）就播放目前這題的音訊。
  // 注意：「標記開始等待播放」這件事故意不是在這個 effect 裡做，而是在觸發 phase 變成
  // 'playing' 的那個地方（handleStart／換題的 setTimeout 回呼）同步做——這是修正一個
  // 實際發生過的小競態：這個播放 effect 跟下面「碼表更新」那個 effect 是兩個獨立的
  // useEffect，同一次換題觸發時，React 依宣告順序先跑碼表更新的 effect（它會立刻執行一次
  // tick()），這時候如果「等待播放」的標記還沒設定好，就會被誤判成「沒有在等待」而多跳動
  //一次，等這個播放 effect 才把標記設好，畫面上會看起來像「先跳一點點時間才凍結」。
  // 把標記設定挪到觸發換題的那個同步程式碼位置，就能保證在任何 effect 執行之前就已經生效。
  //
  // 第一題（questionIndex === 0）的播放不是由這個 effect 觸發，而是 handleStart() 直接
  // 呼叫（見 skipNextAutoPlayRef 宣告處、跟 handleStart() 內的完整說明）——這是修正一個
  // 實際發生過、花了很多輪才抓到的問題：這個 effect 是由 React 狀態變化（phase 變成
  // 'playing'）間接觸發的，中間隔著一次 render／effect 觸發的過程，不是跟使用者點擊
  // 「開始挑戰」同一條呼叫鏈；行動裝置瀏覽器（尤其 iOS Safari）對「播放呼叫要直接連在
  // 使用者手勢後面」的要求非常嚴格，隔著 React 的 effect 觸發，YouTube 播放器就可能
  // 收不到播放狀態變化的事件回報（onStateChange 完全不觸發，但 onReady 正常），即使
  // 呼叫本身有送達、指令也沒有報錯。單機模式能正常播放 YouTube 就是因為它的播放按鈕
  // 直接在 onClick 裡呼叫 play()，沒有這種中間隔層。第二題以後沒辦法避免（本來就是
  // 答對自動換題、沒有使用者手勢可以依附），只能靠第一題這次「乾淨」的直接呼叫，
  // 讓瀏覽器正確核發這個播放器實例接下來整場遊戲的自動播放授權。
  useEffect(() => {
    if (phase !== 'playing') return;
    if (skipNextAutoPlayRef.current) {
      skipNextAutoPlayRef.current = false;
      return;
    }
    const controller = audioControllerRef.current;
    const q = questions[questionIndex];
    if (!controller || !q || !q.source || !q.playbackId) return;
    controller.play(q.source, q.playbackId, q.startSec, q.durationSec);
  }, [phase, questionIndex, questions]);

  // 讓 questionIndexRef／tokenRef 隨時鏡像最新的 state，供 resolveAudioWait 這種可能
  // 從舊 closure 被呼叫到的函式讀取。
  useEffect(() => {
    questionIndexRef.current = questionIndex;
  }, [questionIndex]);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // 開始等待「這一題的音樂真的開始播放」：記錄起始時間戳，同時排一個逾時保險——
  // 見 waitingTimeoutRef 宣告處的說明，逾時秒數跟伺服器扣除上限對齊，最壞情況也只會
  // 卡住這麼久就自動恢復，不會無限卡住。每次開始新的等待都要先清掉舊的逾時計時器，
  // 避免上一題還沒觸發的逾時，跑到這一題才誤觸發。
  //
  // startedAt 參數：換題時（答對非最後一題）會先跑一段緩衝畫面倒數，緩衝結束才呼叫這裡；
  // 呼叫端會把緩衝畫面開始的那個時間戳直接傳進來（而不是用「現在」），讓「緩衝畫面」跟
  // 「等待這一題音樂播放」合併成同一段連續的「死時間」一起量測、一起回報給伺服器——
  // 這是修正一個實際發生過的落差：先前緩衝畫面的扣除是伺服器端用固定公式算的
  // （題目數-1 乘上固定秒數），沒有考慮到 setTimeout 本身的時序不會剛好精準命中這個秒數
  // （瀏覽器排程、React 重新渲染等開銷都會讓實際耗費的時間比理論值多一點點），這個微小
  // 誤差雖然每次都很小，累積 9 次換題後會變成看得出來的落差（成績比玩家實際體驗到的
  // 快了將近一秒）。合併成同一段連續量測、直接回報實際量到的毫秒數，就不會再有這個問題——
  // 沒有傳 startedAt 時（第一題，沒有前面的緩衝畫面）就單純用「現在」當起點。
  function startAudioWait(startedAt?: number) {
    if (waitingTimeoutRef.current !== null) {
      clearTimeout(waitingTimeoutRef.current);
      waitingTimeoutRef.current = null;
    }
    waitingForAudioStartedAtRef.current = startedAt ?? estimateServerNow();
    waitingTimeoutRef.current = setTimeout(() => {
      waitingTimeoutRef.current = null;
      resolveAudioWait();
    }, SPEEDRUN_AUDIO_WAIT_CAP_MS);
  }

  // 統一的「結束等待播放」處理：不管是真的偵測到開始播放、明確的播放錯誤、還是等太久逾時，
  // 都要走這一條路徑，確保碼表一定會恢復跳動、伺服器那邊也一定會收到回報（至少能套用
  // 上限內的扣除），不會讓玩家因為某首歌播放失敗或卡住，就被判定「整段等待時間都不算數、
  // 畫面卡住不動、又聽不到音樂」。用 waitingForAudioStartedAtRef 是否為 null 當防重複觸發
  // 的鎖：三種觸發管道裡不管哪一個先到，只會真正處理一次。
  function resolveAudioWait() {
    if (waitingForAudioStartedAtRef.current === null) return;
    const waitMs = Math.max(0, estimateServerNow() - waitingForAudioStartedAtRef.current);
    pausedMsRef.current += waitMs;
    waitingForAudioStartedAtRef.current = null;
    if (waitingTimeoutRef.current !== null) {
      clearTimeout(waitingTimeoutRef.current);
      waitingTimeoutRef.current = null;
    }
    // 把這裡量到的 waitMs 直接回報給伺服器，讓伺服器只需要負責套用上限、不用自己再猜測
    // 一個起算時間點——這是修正「成績比畫面上看到的少了將近一秒」的根本作法，見
    // lib/server/speedrunSession.ts reportAudioWait 的完整說明。
    if (tokenRef.current) speedrunRepository.reportAudioStarted(tokenRef.current, questionIndexRef.current, waitMs);
  }

  // 「題目準備中」停留超過 5 秒才顯示提示，避免正常情況下（載入通常一兩秒內就完成）
  // 也閃一下這個提示造成不必要的干擾。重置成 false 的動作放在 handleStart() 裡
  // setPhase('loading') 的同一個地方做（同步的一般程式碼，不是在 effect 裡呼叫 setState），
  // 這裡的 effect 只負責「進入 loading 超過 5 秒就設成 true」這一件事。
  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = setTimeout(() => setLoadingTakingAWhile(true), 5000);
    return () => clearTimeout(timer);
  }, [phase]);

  // 偵測到音樂真的開始播放、或明確發生播放錯誤，都視為「等待結束」——錯誤不用等到逾時，
  // 反正已經確定這首歌這次放不出來了，愈早解除凍結、讓玩家能繼續（矇對或反正碼表恢復跳動）
  // 愈好。
  useEffect(() => {
    if (audioStatus !== 'playing' && audioStatus !== 'error') return;
    resolveAudioWait();
  }, [audioStatus]);

  // 監聽分頁從背景切回前景（例如切去別的 App 再切回來）：這是直接回應一個實際觀察到的
  // 現象——手機瀏覽器在某些情況下（可能是省電機制、也可能是背景分頁的資源／逾時計時器
  // 被瀏覽器悄悄延後執行）會讓「等待音樂開始播放」卡住遠超過設定的上限秒數，但只要
  // 切到別的 App 再切回來，遊戲就能繼續——這很可能是手機瀏覽器對「不在前景使用中」的
  // 分頁做了某種延後處理，切換分頁的動作本身重新觸發了正常執行。
  // 與其要求玩家自己發現這個訣竅、手動切來切去，這裡直接監聽 visibilitychange 事件，
  // 分頁重新變成可見時，如果還在等待播放中，就直接視同等待結束處理——這個事件本身
  // 是瀏覽器對「使用者真的切回來了」這個動作的直接反應，不會受到上述計時器延後的影響，
  // 比單純多加幾秒鐘的逾時更可靠。
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      if (waitingForAudioStartedAtRef.current === null) return;
      resolveAudioWait();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // 緩衝畫面（答對後、下一題正式開始前的讀秒動畫）：每秒遞減，數到 0 才真正推進到下一題、
  // 切回 playing 狀態（觸發上面那個 effect 重新播放新題目的音訊）。
  useEffect(() => {
    if (phase !== 'transition') return;
    if (transitionSecondsLeft <= 0) {
      // 用 setTimeout 把狀態更新包進非同步回呼裡，不要在 effect 本體內直接同步呼叫 setState
      // （即使數到 0 這裡邏輯上「該立刻」推進，仍要透過回呼觸發，避免連鎖同步渲染）。
      const timer = setTimeout(() => {
        // 把緩衝畫面開始的時間戳直接交給 startAudioWait，合併成同一段連續的「死時間」——
        // 見 startAudioWait 的完整說明。這裡不再像先前版本那樣單獨把這段緩衝畫面的時間
        // 累加進 pausedMsRef，避免跟合併後的量測重複計算。
        const transitionBeganAt = transitionStartedAtRef.current;
        transitionStartedAtRef.current = null;
        // 在觸發 phase 變成 'playing' 之前，同步設好「開始等待下一題播放」的標記
        // （含逾時保險，見 startAudioWait 的說明），保證任何 effect（包含碼表更新那個）
        // 執行的當下這個標記都已經生效。
        startAudioWait(transitionBeganAt ?? undefined);
        setQuestionIndex((i) => i + 1);
        setPhase('playing');
      }, 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setTransitionSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, transitionSecondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps -- startAudioWait 內部只讀寫 ref，不依賴任何 render 範圍內的變數，加進依賴陣列只會讓這個 effect 因為它每次 render 都重新建立而白白重跑，沒有實際好處

  async function handleStart() {
    // startingRef 是防止重複呼叫的鎖，用 ref（不是 state）是關鍵：如果用 state 檢查
    // 「目前 phase 是不是還在 intro」，使用者在 React 重新渲染、按鈕拿到反映最新 phase
    // 的新版 onClick 之前連續點兩下，兩次點擊抓到的都還是同一個「舊」的事件處理函式
    // （closure 裡的 phase 都還是舊值），state 檢查會兩次都通過，鎖不住。ref 是同步讀寫，
    // 不受渲染時機影響，才能真正擋下「使用者覺得沒反應、不耐煩點第二下」這種情況。
    if (startingRef.current) return;
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      setError('請輸入暱稱');
      return;
    }
    startingRef.current = true;
    // 立刻切到 loading 畫面，讓使用者一點下去就看得到反應，減少「以為沒反應而多點一次」
    // 的機率——即使真的又點了，上面那個 ref 鎖也會確保不會造成問題。
    setPhase('loading');
    setLoadingTakingAWhile(false);

    try {
      // 真正的使用者手勢（按鈕點擊），一定要先等 unlock() 真正跑完才能繼續往下——這是修正
      // 一個實際發生過的 bug：unlock() 內部會借用同一個播放器短暫播放/暫停一支解鎖用的
      // 測試影片（見 AudioController.unlock() 的完整說明），如果不等它，直接讓後面的
      // /start API 呼叫（速度快的話可能很快就回來）觸發第一題的真正播放，兩邊會搶著操作
      // 同一個播放器實例：真正的播放請求把解鎖用的影片換掉、還沒跑完的 unlock() 卻在稍後
      // 誤把「已經換成真正歌曲」的播放器暫停/停止掉——結果就是解鎖用的影片沒被正確消音、
      // 玩家聽到了不該聽到的東西，第一題（如果來源恰好是 YouTube）反而放不出來。
      await audioControllerRef.current?.unlock();

      setError(null);
      const result = await speedrunRepository.start();
      if (!result.ok || !result.data) {
        setError(result.error ?? '開始挑戰失敗');
        setPhase('intro');
        return;
      }

      setToken(result.data.token);
      setQuestions(result.data.questions);
      setQuestionIndex(0);
      setResults(null);
      setSubmitError(null);
      raceStartRef.current = estimateServerNow();
      pausedMsRef.current = 0;
      transitionStartedAtRef.current = null;
      // 同上：在觸發 phase 變成 'playing' 之前，同步設好「開始等待第一題播放」的標記
      // （含逾時保險，見 startAudioWait 的說明）。
      startAudioWait();
      setElapsedMs(0);

      // 第一題的播放直接在這裡呼叫，不透過「換題就播放」那個 effect——這是修正一個
      // 實際發生過、花了很多輪才抓到的根因：那個 effect 是由 phase 變成 'playing' 這個
      // React 狀態變化「間接」觸發的，中間隔著一次 render／effect 觸發，不是跟使用者
      // 點擊「開始挑戰」同一條直接的呼叫鏈。行動裝置瀏覽器（尤其 iOS Safari）對「播放
      // 呼叫要直接連在使用者手勢後面」的要求非常嚴格，隔著 React 的 effect 觸發，
      // YouTube 播放器就可能收不到播放狀態變化的事件回報（onStateChange 完全不觸發，
      // 但 onReady 正常，指令本身沒有報錯），即使 async/await 串起來的整條鏈實際耗時
      // 很短也一樣——關鍵不是花了多少時間，是有沒有經過 React 的 render／effect 邊界。
      // 單機模式能正常播放 YouTube，就是因為它的播放按鈕直接在 onClick 裡呼叫 play()，
      // 沒有這種中間隔層；這裡讓第一題也採用同樣「直接呼叫」的模式。
      // skipNextAutoPlayRef 讓下面那個 effect 知道這次不用它出手（見該 effect 的說明），
      // 不會因為 phase／questionIndex 變化又重複呼叫一次。
      skipNextAutoPlayRef.current = true;
      const firstQuestion = result.data.questions[0];
      if (firstQuestion?.source && firstQuestion.playbackId) {
        audioControllerRef.current?.play(
          firstQuestion.source,
          firstQuestion.playbackId,
          firstQuestion.startSec,
          firstQuestion.durationSec
        );
      }
      setPhase('playing');
    } catch (err) {
      // 防禦性的保底：理論上 speedrunRepository 內部已經把 fetch() 的例外都接住轉換成
      // 正常的錯誤回傳值了，這裡是多一層保險，避免任何其他沒預期到的例外（不管來自
      // unlock() 還是別的地方）沒被接住，導致後面「失敗了切回開頭畫面」的程式碼被跳過、
      // 畫面卡死在「題目準備中」出不來。
      console.error('[handleStart] 未預期的例外：', err);
      setError('開始挑戰失敗，請再試一次');
      setPhase('intro');
    } finally {
      // 不管成功、失敗、還是中途因為沒填暱稱提早 return，都要把鎖解開，
      // 讓使用者修正問題（例如補填暱稱）之後可以正常重新點擊開始。
      startingRef.current = false;
    }
  }

  async function handleChoiceClick(songId: string) {
    // answering 這個「有請求正在處理中」的鎖，是修正「非常快速連續點擊會跳回開頭畫面，
    // 顯示挑戰已逾時」這個問題的關鍵。根因：原本沒有這個鎖，快速連點（甚至只是手指點兩下
    // 太快）會在第一次點擊的回應還沒回來、questionIndex 這個 state 還沒更新之前，
    // 就送出第二個請求，而且第二個請求帶的還是「舊的」questionIndex（React state 還沒更新）。
    // 伺服器依送達順序處理：第一個請求先讓 session 往前推進一題，緊接著處理的第二個請求
    // 一比對，發現自己帶的 questionIndex 已經跟 session 目前的進度對不上，就回傳「找不到／
    // 已逾時」的錯誤——即使第一次點擊其實已經答對了，這個晚到的失敗回應還是會把整個畫面
    // 重置回開頭。加上這個鎖之後，同一時間只會有一個請求在處理中，後面的點擊直接忽略，
    // 不會再送出第二個帶著過期 questionIndex 的請求，這個時序問題就不會發生。
    if (locked || answering || !token) return;
    setAnswering(true);
    const result = await speedrunRepository.check(token, questionIndex, songId);
    setAnswering(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? '判定失敗，請重新開始挑戰');
      setPhase('intro');
      return;
    }

    if (!result.data.correct) {
      // 逞罰機制：答錯鎖定 2 秒不能再選，碼表繼續跑（不會暫停），答錯確實要付出時間代價
      setWrongSongId(songId);
      setLocked(true);
      setTimeout(() => {
        setLocked(false);
        setWrongSongId(null);
      }, WRONG_ANSWER_LOCKOUT_MS);
      return;
    }

    audioControllerRef.current?.stop();

    if (result.data.finished) {
      // 這裡直接把畫面上的碼表「校準」成伺服器剛剛回傳的權威數字，不要繼續讓本地的
      // setInterval 多跳幾下——這是修正一個實際發生過的落差：本地碼表會一路跳到 phase
      // 真正切換到 'submitting' 為止，而這中間還包含這次 check() 請求本身的網路來回時間；
      // 但伺服器認定的 totalTimeMs 是在「剛剛處理這次請求的當下」就算好的，比本地碼表最後
      // 顯示的那個數字還要早一點。兩邊沒對齊的話，玩家會看到「最後一題結束當下顯示的秒數」
      // 跟「結算畫面顯示的成績」差了一截（差距大概就是這次請求來回的網路時間），而且看起來
      // 總是「结算成績比較少」，容易讓人誤以為成績算錯了。直接採用伺服器回傳的數字，
      // 兩邊就會完全一致。
      setElapsedMs(result.data.totalTimeMs ?? 0);
      await submitScore();
    } else {
      // 除了第一題以外，答對後不直接跳下一題，先進入緩衝畫面讓玩家喘口氣、看一下讀秒動畫，
      // 避免題目切換太突兀（第一題不用緩衝，因為那是玩家自己按「開始挑戰」主動觸發的）。
      // 記錄這次緩衝開始的時間點，緩衝結束時才會用來計算這段耗掉多少時間（見上面的 effect）。
      transitionStartedAtRef.current = estimateServerNow();
      setPhase('transition');
      setTransitionSecondsLeft(SPEEDRUN_TRANSITION_SEC);
    }
  }

  async function submitScore() {
    if (!token) return;
    setPhase('submitting');
    setSubmitError(null);
    const result = await speedrunRepository.submit(token, displayName.trim());
    if (!result.ok || !result.data) {
      setSubmitError(result.error ?? '送出成績失敗');
      return;
    }
    setResults(result.data);
    setPhase('results');
  }

  async function loadIntroLeaderboard() {
    if (introLeaderboard !== null) {
      setIntroLeaderboard(null); // 已經展開了，再按一次收合
      return;
    }
    const result = await speedrunRepository.getLeaderboard();
    if (result.ok && result.data) setIntroLeaderboard(result.data);
  }

  function handleRetry() {
    setPhase('intro');
    setResults(null);
    setError(null);
  }

  const inputStyle = {
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid var(--groove)',
    background: 'var(--bg-raised)',
    color: 'var(--ink)',
    fontSize: '1rem',
  };
  // 對應全站共用的 .btn-primary（見 app/globals.css），這裡維持獨立的 JS 常數而不是直接用
  // className，純粹是這個檔案原本就是這個寫法、牽動範圍小，保留一致的視覺數值即可。
  const buttonStyle = {
    padding: '13px 22px',
    borderRadius: '10px',
    border: '1px solid var(--accent)',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    fontWeight: 600,
    fontSize: '0.95rem',
  };
  // 對應 .btn-secondary：次要但有效的動作（這裡是「展開/收合排行榜」），跟主要的
  // 「開始挑戰」用同一個系統裡的次一級視覺權重，而不是借用輸入框樣式硬改
  const secondaryButtonStyle = {
    padding: '13px 22px',
    borderRadius: '10px',
    border: '1px solid var(--accent)',
    background: 'transparent',
    color: 'var(--accent)',
    fontWeight: 600,
    fontSize: '0.95rem',
    cursor: 'pointer' as const,
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
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.8rem' }}>速通挑戰</h1>
      </motion.header>

      {phase === 'intro' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '360px' }}
        >
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', textAlign: 'center' }}>
            隨機片段猜歌＋選擇題搶答，共 {QUESTION_COUNT} 題，碼表計時，答錯鎖 {WRONG_ANSWER_LOCKOUT_MS / 1000} 秒，
            全部答對後看你的名次。
          </p>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="輸入暱稱"
            maxLength={20}
            style={inputStyle}
          />
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem', textAlign: 'center' }}>{error}</p>}
          <motion.button whileTap={{ scale: 0.97 }} onClick={handleStart} style={buttonStyle}>
            開始挑戰
          </motion.button>
          <motion.button whileTap={{ scale: 0.97 }} onClick={loadIntroLeaderboard} style={secondaryButtonStyle}>
            {introLeaderboard !== null ? '收合排行榜 ▲' : '查看目前排行榜 ▼'}
          </motion.button>
          {introLeaderboard !== null && <LeaderboardList entries={introLeaderboard} />}
          <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', textAlign: 'center' }}>
            返回首頁
          </Link>
        </motion.div>
      )}

      {phase === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <p style={{ color: 'var(--ink-dim)' }}>題目準備中…</p>
          {loadingTakingAWhile && (
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', textAlign: 'center', maxWidth: '280px' }}>
              等比較久嗎？如果遲遲沒反應，試試切到別的 App 再切回來，
              或最多等 15 秒會自動顯示錯誤訊息讓你重新開始。
            </p>
          )}
        </div>
      )}

      {phase === 'playing' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', width: '100%', maxWidth: '420px' }}>
          <p style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
            第 {questionIndex + 1} / {questions.length} 題
          </p>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '2.4rem',
              fontWeight: 700,
              color: locked ? 'var(--error)' : 'var(--accent)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatStopwatch(elapsedMs)}
          </p>
          {/*
            答錯提示：固定保留這段文字的高度、用 visibility 切換可見度，而不是條件式掛載/卸載
            整個元素——不然答錯瞬間這段文字冒出來、2 秒後又消失，會讓下面的選項按鈕跟著上下跳動。
            visibility: hidden 讓瀏覽器照樣把它的高度算進版面裡，只是看不見，版面就不會跳動。
          */}
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
            }}
          >
            {questions[questionIndex]?.choices.map((choice) => {
              const isWrongPick = wrongSongId === choice.songId;
              return (
                <motion.button
                  key={choice.songId}
                  onClick={() => handleChoiceClick(choice.songId)}
                  disabled={locked || answering}
                  className={`choice-btn ${isWrongPick ? 'is-wrong' : ''}`}
                  whileTap={{ scale: 0.95 }}
                >
                  {choice.title}
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'transition' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', width: '100%', maxWidth: '420px' }}>
          <p style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
            第 {questionIndex + 2} / {questions.length} 題
          </p>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '2.4rem',
              fontWeight: 700,
              color: 'var(--accent)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatStopwatch(elapsedMs)}
          </p>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>答對了！準備下一題…</p>
          <p
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '3rem',
              color: 'var(--accent)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {transitionSecondsLeft}
          </p>
        </div>
      )}

      {phase === 'submitting' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          {submitError ? (
            <>
              <p style={{ color: 'var(--error)', fontSize: '0.9rem', textAlign: 'center' }}>{submitError}</p>
              <button onClick={submitScore} style={buttonStyle}>
                重試送出成績
              </button>
            </>
          ) : (
            <p style={{ color: 'var(--ink-dim)' }}>送出成績中…</p>
          )}
        </div>
      )}

      {phase === 'results' && results && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', width: '100%', maxWidth: '420px' }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
          >
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>你的成績</p>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '2.2rem',
                fontWeight: 700,
                color: 'var(--accent)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatStopwatch(results.totalTimeMs)}
            </p>
            <p style={{ fontSize: '1.1rem' }}>
              全站第 <strong>{results.rank}</strong> 名（共 {results.totalRuns} 次挑戰）
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            style={{ width: '100%' }}
          >
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: '8px' }}>排行榜 Top 100</p>
            <LeaderboardList entries={results.leaderboard} highlightId={results.scoreId} />
          </motion.div>

          <motion.button whileTap={{ scale: 0.97 }} onClick={handleRetry} style={buttonStyle}>
            再試一次
          </motion.button>
          <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
            返回首頁
          </Link>
        </motion.div>
      )}
    </main>
  );
}

function LeaderboardList({ entries, highlightId }: { entries: SpeedrunLeaderboardEntry[]; highlightId?: string }) {
  if (entries.length === 0) {
    return <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', textAlign: 'center' }}>目前還沒有人上榜，當第一個吧！</p>;
  }
  return (
    <ol
      style={{
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        maxHeight: '360px',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        width: '100%',
      }}
    >
      {entries.map((entry, i) => (
        <li
          key={entry.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderRadius: '8px',
            background: entry.id === highlightId ? 'var(--bg-raised)' : 'transparent',
            border: entry.id === highlightId ? '1px solid var(--accent)' : '1px solid transparent',
            fontSize: '0.9rem',
          }}
        >
          <span>
            {i + 1}. {entry.displayName}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>{formatStopwatch(entry.totalTimeMs)}</span>
        </li>
      ))}
    </ol>
  );
}
