import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { prisma } from '../../../../lib/db';
import { THEME_LIST_SEPARATOR } from '../../../../lib/csv/songCsv';

interface ImportRowResult {
  row: number;
  title: string;
  status: 'created' | 'updated' | 'error' | 'duplicate';
  error?: string;
}

// POST /api/songs/import → 匯入 CSV（純文字 body，Content-Type: text/csv）
// 去重規則：
// 1. youtubeVideoId／appleMusicPreviewUrl／deezerPreviewUrl 其中一個對上既有資料，視為同一首歌，
//    已存在就更新其餘欄位，不存在才新增；
// 2. 三者都對不上時，再比對「歌名 + 歌手」（不分大小寫、去頭尾空白）——
//    這是為了抓出「同一首歌被上傳成不同來源」的情況（重新上傳、MV 版跟歌詞版、
//    或原本只有 YouTube 這次補上 Apple Music/Deezer 等），避免因為來源不同就被誤判成兩首不同的歌，
//    題庫裡出現重複。比對歌名時一併要求歌手也相符，避免不同歌手的同名歌曲被誤判成重複。
//    比對到的話標記為 duplicate 並跳過，不自動覆蓋既有資料，由管理者自行決定是否要手動處理
//    （可能是想保留原本的版本，或想手動補上另一種來源）。
// 歌手／主題用名稱比對（不分大小寫、去頭尾空白），找不到就自動建立，不會因為名稱對不上而整列失敗。
export async function POST(request: NextRequest) {
  try {
    const csvText = await request.text();
    if (!csvText.trim()) {
      return NextResponse.json({ error: 'CSV 內容是空的' }, { status: 400 });
    }

    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (parsed.errors.length > 0) {
      return NextResponse.json(
        { error: `CSV 格式解析錯誤：${parsed.errors[0].message}（第 ${parsed.errors[0].row ?? '?'} 列附近）` },
        { status: 400 }
      );
    }

    const rows = parsed.data;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'CSV 沒有任何資料列（只有標題列或完全是空的）' }, { status: 400 });
    }

    // 歌手／主題名稱 → id 的快取，避免同一批匯入裡重複的名稱一直查詢/建立
    const artistCache = new Map<string, string>();
    const themeCache = new Map<string, string>();

    async function resolveArtistId(name: string): Promise<string> {
      const key = name.trim().toLowerCase();
      const cached = artistCache.get(key);
      if (cached) return cached;

      const existing = await prisma.artist.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } });
      if (existing) {
        artistCache.set(key, existing.id);
        return existing.id;
      }
      const created = await prisma.artist.create({
        data: { id: crypto.randomUUID(), name: name.trim(), gender: 'UNKNOWN' },
      });
      artistCache.set(key, created.id);
      return created.id;
    }

    async function resolveThemeIds(themesCell: string): Promise<string[]> {
      const names = themesCell
        .split(THEME_LIST_SEPARATOR)
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      const ids: string[] = [];
      for (const name of names) {
        const key = name.toLowerCase();
        const cached = themeCache.get(key);
        if (cached) {
          ids.push(cached);
          continue;
        }
        const existing = await prisma.theme.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
        if (existing) {
          themeCache.set(key, existing.id);
          ids.push(existing.id);
          continue;
        }
        const created = await prisma.theme.create({ data: { id: crypto.randomUUID(), name, description: '' } });
        themeCache.set(key, created.id);
        ids.push(created.id);
      }
      return ids;
    }

    const results: ImportRowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // +2：第 1 列是標題列，資料從第 2 列開始，符合 Excel 使用者看到的實際列號
      const row = rows[i];
      const title = (row.title ?? '').trim();
      const artistName = (row.artist ?? '').trim();
      const youtubeVideoId = (row.youtubeVideoId ?? '').trim();
      const appleMusicTrackId = (row.appleMusicTrackId ?? '').trim();
      const appleMusicPreviewUrl = (row.appleMusicPreviewUrl ?? '').trim();
      const appleMusicSkip = (row.appleMusicSkip ?? '').trim().toLowerCase() === 'true';
      const deezerTrackId = (row.deezerTrackId ?? '').trim();
      const deezerPreviewUrl = (row.deezerPreviewUrl ?? '').trim();
      const deezerSkip = (row.deezerSkip ?? '').trim().toLowerCase() === 'true';
      const durationSec = Number(row.durationSec) || 0;
      const lyrics = row.lyrics ?? '';
      const themesCell = row.themes ?? '';

      if (!title || !artistName || (!youtubeVideoId && !appleMusicPreviewUrl && !deezerPreviewUrl)) {
        results.push({
          row: rowNumber,
          title: title || '(空白)',
          status: 'error',
          error: '缺少必要欄位（title、artist，並且 youtubeVideoId／appleMusicPreviewUrl／deezerPreviewUrl 至少要有一個）',
        });
        continue;
      }
      if (durationSec <= 0) {
        results.push({ row: rowNumber, title, status: 'error', error: '「總長」必須大於 0' });
        continue;
      }

      try {
        const artistId = await resolveArtistId(artistName);
        const themeIds = await resolveThemeIds(themesCell);

        const existingSong = await prisma.song.findFirst({
          where: {
            OR: [
              ...(youtubeVideoId ? [{ youtubeVideoId }] : []),
              ...(appleMusicPreviewUrl ? [{ appleMusicPreviewUrl }] : []),
              ...(deezerPreviewUrl ? [{ deezerPreviewUrl }] : []),
            ],
          },
        });

        if (existingSong) {
          await prisma.song.update({
            where: { id: existingSong.id },
            data: {
              title,
              artistId,
              durationSec,
              lyrics,
              // CSV 有填才覆蓋，留空不動既有值（避免匯入時漏填某個來源欄位就把原本已有的資料清空）
              ...(youtubeVideoId ? { youtubeVideoId } : {}),
              ...(appleMusicTrackId ? { appleMusicTrackId } : {}),
              ...(appleMusicPreviewUrl ? { appleMusicPreviewUrl } : {}),
              ...(deezerTrackId ? { deezerTrackId } : {}),
              ...(deezerPreviewUrl ? { deezerPreviewUrl } : {}),
              // skip 標記跟上面的網址/id 欄位不同，一律直接覆蓋成 CSV 裡的值（不分是否為空）——
              // 這正是這兩個欄位存在的目的：管理者在 CSV 裡把它明確標成 true 或清空，
              // 匯入時就要忠實反映 CSV 目前寫的狀態，不能比照網址欄位「留空就不動」的邏輯，
              // 不然這個「已確認沒有來源」的標記本身也會被匯入悄悄蓋掉、失去作用。
              appleMusicSkip,
              deezerSkip,
              themes: { deleteMany: {}, create: themeIds.map((themeId) => ({ themeId })) },
            },
          });
          results.push({ row: rowNumber, title, status: 'updated' });
          continue;
        }

        // 來源都沒對上既有資料，再比對「歌名 + 歌手」是否已存在（同一首歌換了個播放來源）
        const duplicateByTitle = await prisma.song.findFirst({
          where: { artistId, title: { equals: title, mode: 'insensitive' } },
        });
        if (duplicateByTitle) {
          results.push({
            row: rowNumber,
            title,
            status: 'duplicate',
            error: '已有同名同歌手的歌曲存在（來源不同），未匯入，如要更新請到歌曲管理手動編輯',
          });
          continue;
        }

        await prisma.song.create({
          data: {
            id: crypto.randomUUID(),
            title,
            artistId,
            youtubeVideoId: youtubeVideoId || null,
            appleMusicTrackId: appleMusicTrackId || null,
            appleMusicPreviewUrl: appleMusicPreviewUrl || null,
            deezerTrackId: deezerTrackId || null,
            deezerPreviewUrl: deezerPreviewUrl || null,
            appleMusicSkip,
            deezerSkip,
            durationSec,
            lyrics,
            themes: themeIds.length > 0 ? { create: themeIds.map((themeId) => ({ themeId })) } : undefined,
          },
        });
        results.push({ row: rowNumber, title, status: 'created' });
      } catch (err) {
        console.error(`[POST /api/songs/import] 第 ${rowNumber} 列匯入失敗：`, err);
        results.push({ row: rowNumber, title, status: 'error', error: '寫入資料庫失敗' });
      }
    }

    const summary = {
      created: results.filter((r) => r.status === 'created').length,
      updated: results.filter((r) => r.status === 'updated').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      errors: results.filter((r) => r.status === 'error').length,
    };

    return NextResponse.json({ summary, results });
  } catch (err) {
    console.error('[POST /api/songs/import] 匯入失敗：', err);
    return NextResponse.json({ error: '匯入失敗' }, { status: 500 });
  }
}
