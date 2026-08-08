import type { PlayerProfile } from '../types/player';
import { localStore, STORE_NAMES } from '../store/localStore';

export interface RepositoryResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface PlayerRepository {
  getAll(): Promise<RepositoryResult<PlayerProfile[]>>;
  create(profile: PlayerProfile): Promise<RepositoryResult<PlayerProfile>>;
  update(profile: PlayerProfile): Promise<RepositoryResult<PlayerProfile>>;
  remove(id: string): Promise<RepositoryResult<void>>;
}

export const playerRepository: PlayerRepository = {
  async getAll() {
    const result = await localStore.getAll<PlayerProfile>(STORE_NAMES.players);
    return result;
  },

  async create(profile: PlayerProfile) {
    return localStore.put(STORE_NAMES.players, profile);
  },

  async update(profile: PlayerProfile) {
    return localStore.put(STORE_NAMES.players, profile);
  },

  async remove(id: string) {
    return localStore.delete(STORE_NAMES.players, id);
  },
};
