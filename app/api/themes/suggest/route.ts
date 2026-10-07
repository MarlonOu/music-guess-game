import { NextRequest, NextResponse } from 'next/server';
import { suggestThemes, type SuggestItem, type SuggestTheme } from '../../../../lib/server/themeSuggest';
import { allowRequest, getClientIp } from '../../../../lib/server/rateLimit';

const MAX_ITEMS = 100;
const MAX_THEMES = 60;

// POST /api/themes/suggest → 管理用：依歌名、歌手與既有主題清單，建議每首歌適合的主題。
// 屬於 /api/themes 的非 GET 請求，會被 proxy.ts 的管理者驗證擋住（會消耗外部 API 額度）。
// body: { items: [{ key, title, artist }], themes: [{ id, name, description }] }
export async function POST(request: NextRequest) {
  if (!allowRequest(`theme-suggest:${getClientIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 });
  }
  try {
    const body = await request.json();
    const rawItems: unknown[] = Array.isArray(body.items) ? body.items : [];
    const rawThemes: unknown[] = Array.isArray(body.themes) ? body.themes : [];
    const items: SuggestItem[] = rawItems
      .slice(0, MAX_ITEMS)
      .map((i) => i as Partial<SuggestItem>)
      .filter((i) => typeof i.key === 'string' && typeof i.title === 'string')
      .map((i) => ({ key: i.key!, title: i.title!.slice(0, 200), artist: String(i.artist ?? '').slice(0, 100) }));
    const themes: SuggestTheme[] = rawThemes
      .slice(0, MAX_THEMES)
      .map((t) => t as Partial<SuggestTheme>)
      .filter((t) => typeof t.id === 'string' && typeof t.name === 'string')
      .map((t) => ({ id: t.id!, name: t.name!.slice(0, 60), description: String(t.description ?? '').slice(0, 200) }));
    if (items.length === 0 || themes.length === 0) {
      return NextResponse.json({ error: '需要至少一首歌與一個主題' }, { status: 400 });
    }
    return NextResponse.json(await suggestThemes(items, themes));
  } catch (err) {
    console.error('[POST /api/themes/suggest] 失敗：', err);
    return NextResponse.json({ error: '主題建議失敗' }, { status: 500 });
  }
}
