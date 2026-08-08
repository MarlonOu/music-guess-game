const DB_NAME = 'music-guess-game';
const DB_VERSION = 1;

export const STORE_NAMES = {
  players: 'players',
  matches: 'matches',
  matchPlayers: 'matchPlayers',
  rounds: 'rounds',
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用（非瀏覽器環境）'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAMES.players)) {
        db.createObjectStore(STORE_NAMES.players, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.matches)) {
        db.createObjectStore(STORE_NAMES.matches, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.matchPlayers)) {
        db.createObjectStore(STORE_NAMES.matchPlayers, { keyPath: ['matchId', 'playerId'] });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.rounds)) {
        db.createObjectStore(STORE_NAMES.rounds, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface LocalStoreResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export const localStore = {
  async getAll<T>(storeName: StoreName): Promise<LocalStoreResult<T[]>> {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve({ ok: true, data: req.result as T[] });
        req.onerror = () => resolve({ ok: false, error: req.error?.message ?? '讀取失敗' });
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '讀取失敗' };
    }
  },

  async put<T>(storeName: StoreName, value: T): Promise<LocalStoreResult<T>> {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(value);
        req.onsuccess = () => resolve({ ok: true, data: value });
        req.onerror = () => resolve({ ok: false, error: req.error?.message ?? '寫入失敗' });
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '寫入失敗' };
    }
  },

  async delete(storeName: StoreName, key: IDBValidKey): Promise<LocalStoreResult<void>> {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).delete(key);
        req.onsuccess = () => resolve({ ok: true });
        req.onerror = () => resolve({ ok: false, error: req.error?.message ?? '刪除失敗' });
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '刪除失敗' };
    }
  },
};
