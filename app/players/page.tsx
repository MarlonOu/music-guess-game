'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PlayerProfile } from '../../lib/types/player';
import { playerRepository } from '../../lib/repository/playerRepository';
import { PlayerProfileForm } from '../../components/player/PlayerProfileForm';
import { PlayerList } from '../../components/player/PlayerList';
import { generateId } from '../../lib/utils/id';
import { PageShell } from '../../components/layout/PageShell';

function generateAvatarSeed(): string {
  return generateId();
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await playerRepository.getAll();
    if (result.ok && result.data) {
      setPlayers(result.data);
      setError(null);
    } else {
      setError(result.error ?? '讀取對戰人別失敗');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    playerRepository.getAll().then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) {
        setPlayers(result.data);
        setError(null);
      } else {
        setError(result.error ?? '讀取對戰人別失敗');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(displayName: string) {
    const profile: PlayerProfile = editingProfile
      ? { ...editingProfile, displayName }
      : {
          id: generateId(),
          displayName,
          avatarSeed: generateAvatarSeed(),
          createdAt: new Date().toISOString(),
        };

    const result = editingProfile
      ? await playerRepository.update(profile)
      : await playerRepository.create(profile);

    if (!result.ok) {
      setError(result.error ?? '儲存失敗');
      return;
    }

    setEditingProfile(null);
    await reload();
  }

  async function handleDelete(id: string) {
    const result = await playerRepository.remove(id);
    if (!result.ok) {
      setError(result.error ?? '刪除失敗');
      return;
    }
    if (editingProfile?.id === id) setEditingProfile(null);
    await reload();
  }

  return (
    <PageShell title="對戰人別管理" subtitle="這裡建立的玩家會出現在單機模式的玩家選單。">
      {error && (
        <p role="alert" style={{ color: 'var(--error)', fontSize: '0.9rem' }}>
          {error}
        </p>
      )}
      <PlayerProfileForm
        key={editingProfile?.id ?? 'new'}
        editingProfile={editingProfile}
        onSubmit={handleSubmit}
        onCancelEdit={() => setEditingProfile(null)}
      />
      <PlayerList players={players} onEdit={setEditingProfile} onDelete={handleDelete} />
    </PageShell>
  );
}
