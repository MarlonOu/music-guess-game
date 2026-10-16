import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { allowRequest, getClientIp } from '../../../lib/server/rateLimit';
import { sanitizeDisplayName } from '../../../lib/server/sanitizeName';
import { cleanText, countErrors, isCategory, sanitizeEnv, sanitizeLogs } from '../../../lib/server/reportSanitize';

const MAX_BODY_BYTES = 300_000;
const MAX_MESSAGE = 1000;
/** 未處理回報上限：避免被洗版後無法處理 */
const MAX_OPEN = 500;

// POST /api/reports  { category, message, nickname?, contact?, route, env, logs }
// 公開入口（不需登入）。內容一律在伺服器端重新清理與截斷。
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!allowRequest(`report-post:${ip}`, 6, 60 * 60 * 1000)) {
    return NextResponse.json({ error: '一小時內回報次數已達上限，請稍後再試' }, { status: 429 });
  }
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: '回報內容過大' }, { status: 413 });
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: '格式錯誤' }, { status: 400 });
    }
    if (!isCategory(body.category)) {
      return NextResponse.json({ error: '請選擇問題類型' }, { status: 400 });
    }
    const message = cleanText(body.message, MAX_MESSAGE, true);
    if (message.length < 3) {
      return NextResponse.json({ error: '請簡單描述發生了什麼事' }, { status: 400 });
    }
    const openCount = await prisma.errorReport.count({ where: { status: 'open' } });
    if (openCount >= MAX_OPEN) {
      return NextResponse.json({ error: '目前待處理的回報過多，請稍後再試' }, { status: 503 });
    }

    const logs = sanitizeLogs(body.logs);
    const created = await prisma.errorReport.create({
      data: {
        category: body.category,
        message,
        nickname: sanitizeDisplayName(body.nickname),
        contact: cleanText(body.contact, 100),
        route: cleanText(body.route, 200) || '/',
        userAgent: cleanText(request.headers.get('user-agent'), 400),
        env: sanitizeEnv(body.env),
        logs: logs as unknown as object,
        logCount: logs.length,
        errorCount: countErrors(logs),
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (error) {
    console.error('POST /api/reports failed', error);
    return NextResponse.json({ error: '送出失敗，請稍後再試' }, { status: 500 });
  }
}
