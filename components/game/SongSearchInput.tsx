'use client';

import { useMemo, useState } from 'react';
import type { SongIndexItem } from '../../lib/client/useSongIndex';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s　]+/g, '');
}

interface SongSearchInputProps {
  value: string;
  /** 目前選中的歌（從清單點選或按 Enter 選取）；使用者再打字就會清成 null */
  pickedId: string | null;
  onChange: (value: string, pickedId: string | null) => void;
  songs: SongIndexItem[];
  placeholder?: string;
  /** false 時不顯示建議清單（例如純聊天階段） */
  suggest?: boolean;
  /** 沒有任何建議可選時，Enter 的預設行為交還給 form submit */
  inputRef?: React.Ref<HTMLInputElement>;
  ariaLabel?: string;
  listId: string;
  maxResults?: number;
}

/**
 * 歌名／歌手關鍵字搜尋輸入框：輸入任一關鍵字即時列出符合的歌曲（歌名或歌手），
 * 支援鍵盤上下選取、Enter 帶入、Esc 關閉。無限連勝與線上打字搶答共用。
 */
export function SongSearchInput({
  value,
  pickedId,
  onChange,
  songs,
  placeholder,
  suggest = true,
  inputRef,
  ariaLabel,
  listId,
  maxResults = 6,
}: SongSearchInputProps) {
  const [focused, setFocused] = useState(false);
  const [hi, setHi] = useState(0);

  const suggestions = useMemo(() => {
    const q = normalize(value);
    if (!suggest || !q || pickedId) return [];
    const starts: SongIndexItem[] = [];
    const contains: SongIndexItem[] = [];
    for (const s of songs) {
      const t = normalize(s.title);
      const a = normalize(s.artist);
      if (t.startsWith(q) || a.startsWith(q)) starts.push(s);
      else if (t.includes(q) || a.includes(q)) contains.push(s);
      if (starts.length >= maxResults) break;
    }
    return [...starts, ...contains].slice(0, maxResults);
  }, [value, pickedId, songs, suggest, maxResults]);

  function pick(song: SongIndexItem) {
    onChange(song.title, song.id);
    setHi(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(suggestions[hi] ?? suggestions[0]);
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  }

  const open = focused && suggestions.length > 0;

  return (
    <div className="song-search-wrap">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value, null);
          setHi(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="field"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        enterKeyHint="go"
      />
      {open && (
        <ul id={listId} className="song-search-list" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === hi}
              className={i === hi ? 'is-hi' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              <span>{s.title}</span>
              <small>{s.artist}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
