import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { loadRoomState, generateJoinCode } from '../../../lib/server/roomState';

// POST /api/rooms → 建立新房間，建立者自動成為房主與第一位玩家
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { displayName, mode } = body;

    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
      return NextResponse.json({ error: '請輸入暱稱' }, { status: 400 });
    }
    if (!['INTRO', 'RANDOM_CLIP', 'LYRIC_LINE'].includes(mode)) {
      return NextResponse.json({ error: '無效的遊戲模式' }, { status: 400 });
    }

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
        artistFilterIds: [],
        themeFilterIds: [],
        songQueue: [],
        clipStartSecs: [],
        lyricLineIndexes: [],
        hostPlayerId: '', // 建立玩家紀錄後回填
      },
    });

    const hostPlayer = await prisma.roomPlayer.create({
      data: { id: crypto.randomUUID(), roomId: room.id, displayName: displayName.trim() },
    });

    await prisma.room.update({ where: { id: room.id }, data: { hostPlayerId: hostPlayer.id } });

    const state = await loadRoomState(joinCode);
    return NextResponse.json({ room: state, playerId: hostPlayer.id }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/rooms] 建立房間失敗：', err);
    return NextResponse.json({ error: '建立房間失敗' }, { status: 500 });
  }
}
