import { prisma } from '../db';

/** 房間最後一次狀態變動後超過這段時間就視為閒置，連同玩家與訊息一起刪除（關聯皆為 onDelete: Cascade）。 */
export const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
/** 清理最多每隔這段時間跑一次，避免每次建房都掃一次資料表。 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const globalForCleanup = globalThis as unknown as { __roomCleanupAt?: number; __roomCleanupRunning?: boolean };

/**
 * 不阻塞的閒置房間清理：在建立房間時順手觸發，距離上次清理超過 CLEANUP_INTERVAL_MS 才真的執行。
 * 先前房間與訊息從不刪除，資料表會隨使用量（或惡意大量建房）無限成長。
 */
export function maybeCleanupIdleRooms(): void {
  const now = Date.now();
  const last = globalForCleanup.__roomCleanupAt ?? 0;
  if (globalForCleanup.__roomCleanupRunning || now - last < CLEANUP_INTERVAL_MS) return;
  globalForCleanup.__roomCleanupAt = now;
  globalForCleanup.__roomCleanupRunning = true;
  prisma.room
    .deleteMany({ where: { updatedAt: { lt: new Date(now - ROOM_IDLE_TTL_MS) } } })
    .then(({ count }) => {
      if (count > 0) console.log(`[roomCleanup] 已刪除 ${count} 個閒置房間`);
    })
    .catch((err) => console.error('[roomCleanup] 清理閒置房間失敗：', err))
    .finally(() => {
      globalForCleanup.__roomCleanupRunning = false;
    });
}
