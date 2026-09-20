-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "answer_mode" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "rooms" ADD COLUMN     "choice_song_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
