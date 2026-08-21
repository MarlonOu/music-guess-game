/**
 * 追蹤本地裝置時鐘跟伺服器時鐘之間的偏移量（簡化版 NTP 校時）。
 *
 * 為什麼需要這個：房間裡的倒數／換題時機，是拿伺服器發的絕對時間戳（roundStartedAt、
 * lastRevealedAt）跟本地時間比較算出來的。如果某台裝置的系統時鐘本身沒校準
 * （沒開自動校時、時區/日光節約跳動沒校正回來，這在手機上其實蠻常見），直接拿那台裝置的
 * Date.now() 去比較，算出來的倒數／換題時機就會固定差一截——這不是網路延遲造成的
 * （網路延遲是浮動的，這是裝置時鐘本身的固定偏移，且不會自己恢復），必須主動量測、主動校正。
 *
 * 用法：每次拿到房間輪詢 API 回應裡的 serverTime，呼叫 recordServerTime() 更新偏移量估計；
 * 需要「伺服器現在幾點」時呼叫 estimateServerNow()，取代直接呼叫 Date.now()。
 */

let offsetMs = 0;
let hasEstimate = false;

/**
 * 記錄一次伺服器時間戳，搭配這次 API 請求發出／收到回應當下的本地時間戳，
 * 估計偏移量：假設伺服器產生這個時間戳的當下，剛好落在這次網路來回的中間點，
 * 用來回時間的一半補償網路延遲，而不是直接拿「收到回應那一刻」的本地時間去比對
 * （那樣會把整段網路延遲也誤算進偏移量裡，量測會不準）。
 *
 * 偏移量的更新用指數移動平均而非直接取代最新一次量測值，避免單次網路延遲異常大/小
 * 導致偏移量估計忽大忽小；同時仍能在幾次輪詢內收斂到正確值，反映裝置時鐘真正的偏移量。
 */
export function recordServerTime(serverTimeIso: string, requestSentAtMs: number, responseReceivedAtMs: number): void {
  const serverTimeMs = new Date(serverTimeIso).getTime();
  if (Number.isNaN(serverTimeMs)) return;

  const roundTripMs = responseReceivedAtMs - requestSentAtMs;
  const estimatedServerNowAtReceiveMs = serverTimeMs + roundTripMs / 2;
  const newOffset = estimatedServerNowAtReceiveMs - responseReceivedAtMs;

  if (!hasEstimate) {
    offsetMs = newOffset;
    hasEstimate = true;
  } else {
    offsetMs = offsetMs * 0.8 + newOffset * 0.2;
  }
}

/** 估計伺服器現在的時間戳（毫秒），供跟 roundStartedAt／lastRevealedAt 等伺服器時間戳比較用 */
export function estimateServerNow(): number {
  return Date.now() + offsetMs;
}
