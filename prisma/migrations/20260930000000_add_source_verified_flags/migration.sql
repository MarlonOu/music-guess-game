-- AlterTable
ALTER TABLE "songs" ADD COLUMN     "apple_music_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "songs" ADD COLUMN     "deezer_verified" BOOLEAN NOT NULL DEFAULT false;
