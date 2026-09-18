-- AlterTable
ALTER TABLE "songs" ALTER COLUMN "youtube_video_id" DROP NOT NULL;
ALTER TABLE "songs" ADD COLUMN     "apple_music_track_id" TEXT;
ALTER TABLE "songs" ADD COLUMN     "apple_music_preview_url" TEXT;
