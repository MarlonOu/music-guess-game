-- AlterTable
ALTER TABLE "songs" ADD COLUMN     "apple_music_skip" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "songs" ADD COLUMN     "deezer_skip" BOOLEAN NOT NULL DEFAULT false;
