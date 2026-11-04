import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { loadRoomState } from '../../../../../lib/server/roomState';
import { readJsonBody, sanitizeIdList } from '../../../../../lib/server/requestGuards';
import { authenticatePlayer } from '../../../../../lib/server/playerAuth';

const VALID_MODES = ['INTRO', 'RANDOM_CLIP', 'LYRIC_LINE'];

// PATCH /api/rooms/:joinCode/settings → 房主更新模式／歌手篩選／主題篩選（只能在 lobby 狀態下修改）
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const { playerId, mode, answerMode } = parsed.body;
    // 篩選清單會出現在每一次房間狀態輪詢回應裡，限制數量與長度，避免被塞入超大陣列
    const artistFilterIds = sanitizeIdList(parsed.body.artistFilterIds);
    const themeFilterIds = sanitizeIdList(parsed.body.themeFilterIds);
    if (mode !== undefined && (typeof mode !== 'string' || !VALID_MODES.includes(mode))) {
      return NextResponse.json({ error: '無效的遊戲模式' }, { status: 400 });
    }

    const room = await prisma.room.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!room) {
      return NextResponse.json({ error: '找不到這個房間' }, { status: 404 });
    }
    // playerId 會出現在公開的房間狀態裡，必須附上本人的玩家憑證才算數（見 lib/server/playerAuth.ts）
    const auth = await authenticatePlayer(request, parsed.body, room.id);
    if (!auth.ok) return auth.response;
    if (room.hostPlayerId !== playerId) {
      return NextResponse.json({ error: '只有房主可以修改遊戲設定' }, { status: 403 });
    }
    if (room.status !== 'lobby') {
      return NextResponse.json({ error: '比賽進行中無法修改設定' }, { status: 409 });
    }

    await prisma.room.update({
      where: { id: room.id },
      data: {
        ...(typeof mode === 'string' ? { mode } : {}),
        ...(answerMode === 'text' || answerMode === 'choice' ? { answerMode } : {}),
        ...(artistFilterIds ? { artistFilterIds } : {}),
        ...(themeFilterIds ? { themeFilterIds } : {}),
      },
    });

    const state = await loadRoomState(room.joinCode);
    return NextResponse.json({ room: state });
  } catch (err) {
    console.error(`[PATCH /api/rooms/${joinCode}/settings] 更新設定失敗：`, err);
    return NextResponse.json({ error: '更新設定失敗' }, { status: 500 });
  }
}
