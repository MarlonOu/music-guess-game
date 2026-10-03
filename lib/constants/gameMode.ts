import type { GameMode } from '../types/match';

/**
 * 可選玩法清單——單機模式的比賽設定表單（components/match/MatchSetupForm.tsx）跟
 * 線上模式房間的設定畫面（app/online/room/[joinCode]/page.tsx 的 LobbyView）共用
 * 同一份定義，確保兩邊看到的玩法名稱、說明文字、順序永遠一致，不會有「單機改了文案、
 * 線上忘記一起改」的情況。
 *
 * LYRIC_LINE（歌詞猜歌）先不放進這份清單——這不是刪除這個玩法，GameMode 型別跟後端
 * 相關邏輯都還留著，只是先不讓玩家在單機／線上的設定畫面選到它。要重新開放時，
 * 把下面註解掉的那一項取消註解即可。
 */
export const SELECTABLE_GAME_MODES: { code: GameMode; label: string; desc: string }[] = [
  { code: 'INTRO', label: '前奏猜歌', desc: '從頭播放指定秒數，考驗對前奏的記憶' },
  { code: 'RANDOM_CLIP', label: '隨機片段猜歌', desc: '隨機截取一段，副歌、主歌都可能出現' },
  // { code: 'LYRIC_LINE', label: '歌詞猜歌', desc: '只顯示一句歌詞文字，不會播放聲音' },
];
