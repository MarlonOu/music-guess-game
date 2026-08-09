import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 起，schema.prisma 的 datasource 區塊不再放連線字串，
// 統一改由本檔案管理（CLI 指令，如 migrate/generate/db seed，皆讀此檔）。
// 詳見 https://www.prisma.io/docs/orm/reference/prisma-config-reference
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx --env-file=.env prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
