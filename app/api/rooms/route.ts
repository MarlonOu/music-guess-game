import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { loadRoomState, generateJoinCode } from '../../../lib/server/roomState';
import { sanitizeDisplayName } from '../../../lib/server/sanitizeName';
import { rateLimitByIp, readJsonBody } from '../../../lib/server/requestGuards';
import { maybeCleanupIdleRooms } from '../../../lib/server/roomCleanup';
import { issuePlayerToken } from '../../../lib/server/playerAuth';

// POST /api/rooms → 建立新房間，建立者自動成為房主與第一位玩家
export async function POST(request: NextRequest) {
  // 每個 IP 每分鐘最多建 10 間房：正常使用一次只會建一間，這個額度足以涵蓋重來幾次的情況
  const limited = rateLimitByIp(request, 'room-create', 10, 60_000);
  if (limited) return limited;
  maybeCleanupIdleRooms();
  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const { mode, answerMode } = parsed.body;
    // 移除控制字元／零寬字元並截斷為 20 字（與排行榜暱稱同一套規則）
    const displayName = sanitizeDisplayName(parsed.body.displayName);

    if (!displayName) {
      return NextResponse.json({ error: '請輸入暱稱' }, { status: 400 });
    }
    if (typeof mode !== 'string' || !['INTRO', 'RANDOM_CLIP', 'LYRIC_LINE'].includes(mode)) {
      return NextResponse.json({ error: '無效的遊戲模式' }, { status: 400 });
    }
    // 沒帶或帶了無效值一律當作 'text'（打字搶答，維持既有預設行為），不因為漏帶這個新欄位而失敗
    const resolvedAnswerMode = answerMode === 'choice' ? 'choice' : 'text';

    // joinCode 極小機率撞號，重試幾次
    let joinCode = generateJoinCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await prisma.room.findUnique({ where: { joinCode } });
      if (!existing) break;
      joinCode = generateJoinCode();
    }

    const room = await prisma.room.create({
      data: {
        id: crypto.randomUUID(),
        joinCode,
        mode,
        answerMode: resolvedAnswerMode,
        artistFilterIds: [],
        themeFilterIds: [],
        songQueue: [],
        clipStartSecs: [],
        lyricLineIndexes: [],
        hostPlayerId: '', // 建立玩家紀錄後回填
      },
    });

    const { token: playerToken, tokenHash } = issuePlayerToken();
    const hostPlayer = await prisma.roomPlayer.create({
      data: { id: crypto.randomUUID(), roomId: room.id, displayName, tokenHash },
    });

    await prisma.room.update({ where: { id: room.id }, data: { hostPlayerId: hostPlayer.id } });

    const state = await loadRoomState(joinCode);
    // playerToken 只出現在這一次回應裡，之後代表房主的操作都要附上（見 lib/server/playerAuth.ts）
    return NextResponse.json({ room: state, playerId: hostPlayer.id, playerToken }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/rooms] 建立房間失敗：', err);
    return NextResponse.json({ error: '建立房間失敗' }, { status: 500 });
  }
}
