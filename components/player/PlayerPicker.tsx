'use client';

import { useEffect, useState } from 'react';
import type { PlayerProfile } from '../../lib/types/player';
import { playerRepository } from '../../lib/repository/playerRepository';
import { generateId } from '../../lib/utils/id';

interface PlayerPickerProps {
  selected: PlayerProfile[];
  onChange: (players: PlayerProfile[]) => void;
  onError: (msg: string) => void;
}

function generateAvatarSeed(): string {
  return generateId();
}

/**
 * 這次要一起玩的人可以用兩種方式加入：
 * 1. 直接打名字新增（同時建立一筆新的對戰人別紀錄，之後可從歷史紀錄再匯入）
 * 2. 點旁邊的圖示，從歷史紀錄（既有對戰人別）挑選加入
 * 已選的人顯示成一排標籤，各自可以單獨移除。
 */
export function PlayerPicker({ selected, onChange, onError }: PlayerPickerProps) {
  const [newName, setNewName] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [allProfiles, setAllProfiles] = useState<PlayerProfile[]>([]);

  useEffect(() => {
    let cancelled = false;
    playerRepository.getAll().then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) setAllProfiles(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [historyOpen]);

  async function handleAddNew(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (trimmed.length === 0) return;

    // 重複玩家卡控：名字比對不分大小寫/去頭尾空白。
    // 已經在這場名單裡 → 直接擋下；名字跟歷史紀錄裡的某個人一樣 → 沿用既有那筆，不要又建一筆同名的新資料。
    const normalized = trimmed.toLowerCase();
    if (selected.some((p) => p.displayName.trim().toLowerCase() === normalized)) {
      onError(`「${trimmed}」已經在這場名單裡了`);
      return;
    }
    const existingProfile = allProfiles.find((p) => p.displayName.trim().toLowerCase() === normalized);
    if (existingProfile) {
      onChange([...selected, existingProfile]);
      setNewName('');
      return;
    }

    const profile: PlayerProfile = {
      id: generateId(),
      displayName: trimmed,
      avatarSeed: generateAvatarSeed(),
      createdAt: new Date().toISOString(),
    };
    const result = await playerRepository.create(profile);
    if (!result.ok) {
      onError(result.error ?? '新增對戰人別失敗');
      return;
    }
    onChange([...selected, profile]);
    setNewName('');
  }

  function removePlayer(id: string) {
    onChange(selected.filter((p) => p.id !== id));
  }

  function addFromHistory(profile: PlayerProfile) {
    if (selected.some((p) => p.id === profile.id)) return;
    onChange([...selected, profile]);
  }

  const notYetSelected = allProfiles.filter((p) => !selected.some((s) => s.id === p.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {selected.map((p) => (
            <span
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                borderRadius: '999px',
                border: '1px solid var(--groove)',
                background: 'var(--bg-raised)',
                fontSize: '0.9rem',
              }}
            >
              {p.displayName}
              <button
                type="button"
                onClick={() => removePlayer(p.id)}
                aria-label={`移除 ${p.displayName}`}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--ink-dim)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={handleAddNew} style={{ display: 'flex', gap: '8px' }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="輸入新玩家名字"
          className="field"
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary">
          新增
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          aria-label="從歷史紀錄匯入"
          title="從歷史紀錄匯入"
          className="btn btn-ghost"
        >
          📜
        </button>
      </form>

      {historyOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setHistoryOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--groove)',
              borderRadius: '14px',
              padding: '20px',
              width: '100%',
              maxWidth: '360px',
              maxHeight: '70vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '1.05rem', fontWeight: 600 }}>從歷史紀錄匯入</span>
            {notYetSelected.length === 0 ? (
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>
                {allProfiles.length === 0 ? '尚無歷史對戰人別紀錄' : '其餘的人都已經加入這場了'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {notYetSelected.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addFromHistory(p)}
                    className="btn btn-ghost"
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                  >
                    {p.displayName}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setHistoryOpen(false)} className="btn btn-primary" style={{ marginTop: '8px' }}>
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
