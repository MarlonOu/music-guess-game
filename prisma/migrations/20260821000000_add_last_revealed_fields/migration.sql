-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "last_revealed_title" TEXT;
ALTER TABLE "rooms" ADD COLUMN     "last_revealed_artist" TEXT;
ALTER TABLE "rooms" ADD COLUMN     "last_revealed_theme_labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "rooms" ADD COLUMN     "last_revealed_at" TIMESTAMP(3);
