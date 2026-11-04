import { NextRequest, NextResponse } from 'next/server';
import { allowRequest, getClientIp } from './rateLimit';

/** 線上房間相關 API 的請求主體上限。正常請求只有暱稱、playerId、短訊息，幾百 bytes 就夠。 */
export const ROOM_BODY_MAX_BYTES = 8 * 1024;

/** 聊天／搶答訊息長度上限。歌名本身遠短於此，截斷不影響答案比對。 */
export const CHAT_MESSAGE_MAX_LENGTH = 100;

/** 房主可設定的歌手／主題篩選數量上限，每個 id 的長度上限。 */
export const FILTER_IDS_MAX = 100;
export const FILTER_ID_MAX_LENGTH = 64;

export type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

/**
 * 讀取 JSON 主體並限制大小：邊讀邊累計，超過上限立刻中止，不會先把整個超大請求讀進記憶體。
 * 主體不是 JSON 物件時回 400。
 */
export async function readJsonBody(request: NextRequest, maxBytes = ROOM_BODY_MAX_BYTES): Promise<JsonBodyResult> {
  const tooLarge = () => ({
    ok: false as const,
    response: NextResponse.json({ error: '請求內容過大' }, { status: 413 }),
  });
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return tooLarge();

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return tooLarge();
      }
      chunks.push(value);
    }
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: NextResponse.json({ error: '資料格式不正確' }, { status: 400 }) };
  }
}

/**
 * 每個來源 IP 的頻率限制。超過時回傳 429 回應，未超過回傳 null。
 * scope 用來區分不同端點各自的額度。
 */
export function rateLimitByIp(
  request: NextRequest,
  scope: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  if (allowRequest(`${scope}:${getClientIp(request)}`, limit, windowMs)) return null;
  return NextResponse.json({ error: '操作太頻繁了，請稍後再試' }, { status: 429 });
}

/** 清理篩選 id 陣列：只留字串、截斷長度、去重、限制數量。非陣列回傳 undefined（代表不更新）。 */
export function sanitizeIdList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const id = v.trim().slice(0, FILTER_ID_MAX_LENGTH);
    if (id) out.add(id);
    if (out.size >= FILTER_IDS_MAX) break;
  }
  return [...out];
}
