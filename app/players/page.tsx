'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { PlayerProfile } from '../../lib/types/player';
import { playerRepository } from '../../lib/repository/playerRepository';
import { PlayerProfileForm } from '../../components/player/PlayerProfileForm';
import { PlayerList } from '../../components/player/PlayerList';
import { generateId } from '../../lib/utils/id';

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
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px',
        gap: '24px',
      }}
    >
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}
      >
        <span style={{ color: 'var(--ink-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          MUSIC GUESS
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>對戰人別管理</h1>
      </motion.header>

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
        style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
      >
        <PlayerProfileForm
          key={editingProfile?.id ?? 'new'}
          editingProfile={editingProfile}
          onSubmit={handleSubmit}
          onCancelEdit={() => setEditingProfile(null)}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.18, ease: 'easeOut' }}
        style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
      >
        <PlayerList players={players} onEdit={setEditingProfile} onDelete={handleDelete} />
      </motion.div>

      <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
        返回首頁
      </Link>
    </main>
  );
}
