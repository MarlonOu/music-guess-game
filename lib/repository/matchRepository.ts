import type { Match, MatchPlayer, Round } from '../types/match';
import { localStore, STORE_NAMES } from '../store/localStore';
import type { RepositoryResult } from './playerRepository';

export interface MatchRepository {
  createMatch(match: Match): Promise<RepositoryResult<Match>>;
  addMatchPlayer(matchPlayer: MatchPlayer): Promise<RepositoryResult<MatchPlayer>>;
  addRound(round: Round): Promise<RepositoryResult<Round>>;
  getAllMatches(): Promise<RepositoryResult<Match[]>>;
}

export const matchRepository: MatchRepository = {
  async createMatch(match: Match) {
    return localStore.put(STORE_NAMES.matches, match);
  },

  async addMatchPlayer(matchPlayer: MatchPlayer) {
    return localStore.put(STORE_NAMES.matchPlayers, matchPlayer);
  },

  async addRound(round: Round) {
    return localStore.put(STORE_NAMES.rounds, round);
  },

  async getAllMatches() {
    return localStore.getAll<Match>(STORE_NAMES.matches);
  },
};
