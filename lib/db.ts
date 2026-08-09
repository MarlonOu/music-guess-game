import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Next.js 開發模式下模組會因熱重載被重新執行，若每次都 new PrismaClient()
// 會不斷開新連線導致連線數耗盡；以 globalThis 快取單一實例避免此問題。
// 正式環境（production）每個 process 本來就只執行一次，不受影響。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 起 Client 強制要求 driver adapter（不再內建 Rust query engine）。
// DATABASE_URL 由 Next.js 自動載入 .env，不需額外 dotenv 設定。
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
