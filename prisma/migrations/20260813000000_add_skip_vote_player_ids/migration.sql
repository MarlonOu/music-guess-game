-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "skip_vote_player_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
