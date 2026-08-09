// 將 data/songs.json 的內容匯入 Postgres（Artist、Song 兩張表）。
// 用途：JSON 檔案仍作為「可人工編輯、可 git diff」的題庫來源，
// scripts/populate-youtube-ids.mjs 負責補上 youtubeVideoId 後，
// 用本腳本把最新內容同步進資料庫，供 API route 讀取。
//
// 使用方式：
//   pnpm db:seed
//
// 為何用 tsx 而非純 node 執行：Prisma 7 的 prisma-client 產生器輸出的是
// .ts 原始檔（非編譯後的 .js），純 Node 無法直接載入，需透過 tsx 執行。

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface SeedArtist {
  id: string;
  name: string;
  gender: string;
}

interface SeedSong {
  id: string;
  title: string;
  artistId: string;
  audioUrl?: string;
  youtubeVideoId: string;
  durationSec: number;
  lyrics: string;
}

async function main() {
  const raw = await readFile(path.resolve(__dirname, '../data/songs.json'), 'utf-8');
  const data: { artists: SeedArtist[]; songs: SeedSong[] } = JSON.parse(raw);

  // 完全同步（而非單純 upsert）：先清空再依 JSON 重建，
  // 避免 data/songs.json 刪除或改名歌曲後，資料庫仍殘留舊資料（例如先前的示範歌曲）。
  // 依外鍵順序先刪 Song 再刪 Artist。
  await prisma.song.deleteMany({});
  await prisma.artist.deleteMany({});

  for (const artist of data.artists) {
    await prisma.artist.create({
      data: { id: artist.id, name: artist.name, gender: artist.gender },
    });
  }
  console.log(`已同步 ${data.artists.length} 位歌手`);

  for (const song of data.songs) {
    await prisma.song.create({
      data: {
        id: song.id,
        title: song.title,
        artistId: song.artistId,
        audioUrl: song.audioUrl ?? null,
        youtubeVideoId: song.youtubeVideoId,
        durationSec: song.durationSec,
        lyrics: song.lyrics,
      },
    });
  }
  console.log(`已同步 ${data.songs.length} 首歌曲`);
}

main()
  .catch((err) => {
    console.error('Seed 失敗：', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
