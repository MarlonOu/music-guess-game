import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { prisma } from '../../../../lib/db';
import { THEME_LIST_SEPARATOR } from '../../../../lib/csv/songCsv';

interface ImportRowResult {
  row: number;
  title: string;
  status: 'created' | 'updated' | 'error';
  error?: string;
}

// POST /api/songs/import → 匯入 CSV（純文字 body，Content-Type: text/csv）
// 去重規則：同一個 youtubeVideoId 視為同一首歌，已存在就更新其餘欄位，不存在才新增；
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
      const durationSec = Number(row.durationSec) || 0;
      const lyrics = row.lyrics ?? '';
      const themesCell = row.themes ?? '';

      if (!title || !artistName || !youtubeVideoId) {
        results.push({ row: rowNumber, title: title || '(空白)', status: 'error', error: '缺少必要欄位（title、artist、youtubeVideoId）' });
        continue;
      }
      if (durationSec <= 0) {
        results.push({ row: rowNumber, title, status: 'error', error: '「總長」必須大於 0' });
        continue;
      }

      try {
        const artistId = await resolveArtistId(artistName);
        const themeIds = await resolveThemeIds(themesCell);

        const existingSong = await prisma.song.findFirst({ where: { youtubeVideoId } });

        if (existingSong) {
          await prisma.song.update({
            where: { id: existingSong.id },
            data: {
              title,
              artistId,
              durationSec,
              lyrics,
              themes: { deleteMany: {}, create: themeIds.map((themeId) => ({ themeId })) },
            },
          });
          results.push({ row: rowNumber, title, status: 'updated' });
        } else {
          await prisma.song.create({
            data: {
              id: crypto.randomUUID(),
              title,
              artistId,
              youtubeVideoId,
              durationSec,
              lyrics,
              themes: themeIds.length > 0 ? { create: themeIds.map((themeId) => ({ themeId })) } : undefined,
            },
          });
          results.push({ row: rowNumber, title, status: 'created' });
        }
      } catch (err) {
        console.error(`[POST /api/songs/import] 第 ${rowNumber} 列匯入失敗：`, err);
        results.push({ row: rowNumber, title, status: 'error', error: '寫入資料庫失敗' });
      }
    }

    const summary = {
      created: results.filter((r) => r.status === 'created').length,
      updated: results.filter((r) => r.status === 'updated').length,
      errors: results.filter((r) => r.status === 'error').length,
    };

    return NextResponse.json({ summary, results });
  } catch (err) {
    console.error('[POST /api/songs/import] 匯入失敗：', err);
    return NextResponse.json({ error: '匯入失敗' }, { status: 500 });
  }
}
