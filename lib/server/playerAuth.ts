import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../db';

/**
 * 線上房間的玩家身分驗證。
 *
 * playerId 會出現在公開的房間狀態（玩家名單、hostPlayerId），任何知道房號的人都看得到，
 * 先前所有操作只比對 body 裡的 playerId，等於任何人都能冒充任何玩家（含房主）結束比賽、
 * 改設定、以他人名義發言或把人踢出。現在建立／加入房間時另外發一組只給本人的隨機憑證，
 * 之後的操作都要附上（HTTP 標頭 x-player-token；sendBeacon 無法自訂標頭，改放 body 的 playerToken）。
 * 資料庫只存雜湊，資料庫內容外流也無法拿來冒充。
 */
export const PLAYER_TOKEN_HEADER = 'x-player-token';

export function issuePlayerToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: hashPlayerToken(token) };
}

export function hashPlayerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPlayerToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type AuthenticatedPlayer = { id: string; roomId: string; displayName: string; score: number };

export type PlayerAuthResult =
  | { ok: true; player: AuthenticatedPlayer }
  | { ok: false; response: NextResponse };

/**
 * 確認這個請求確實是 playerId 本人發出，且這位玩家屬於指定房間。
 * 找不到玩家回 404（沿用各端點原本「可能已離開房間」的語意，前端既有的自我修復流程會接手），
 * 憑證不符回 403。
 */
export async function authenticatePlayer(
  request: NextRequest,
  body: Record<string, unknown>,
  roomId: string
): Promise<PlayerAuthResult> {
  const playerId = body.playerId;
  if (typeof playerId !== 'string' || !playerId) {
    return { ok: false, response: NextResponse.json({ error: '缺少必要欄位（playerId）' }, { status: 400 }) };
  }
  const player = await prisma.roomPlayer.findUnique({ where: { id: playerId } });
  if (!player || player.roomId !== roomId) {
    return { ok: false, response: NextResponse.json({ error: '找不到這位玩家，可能已離開房間' }, { status: 404 }) };
  }
  // 欄位加入前就存在的玩家沒有憑證，視為舊資料放行
  if (player.tokenHash) {
    const headerToken = request.headers.get(PLAYER_TOKEN_HEADER);
    const token = headerToken || (typeof body.playerToken === 'string' ? body.playerToken : '');
    if (!token || !tokenMatches(token, player.tokenHash)) {
      return {
        ok: false,
        response: NextResponse.json({ error: '玩家身分驗證失敗，請重新整理頁面' }, { status: 403 }),
      };
    }
  }
  return {
    ok: true,
    player: { id: player.id, roomId: player.roomId, displayName: player.displayName, score: player.score },
  };
}
