-- CreateTable
CREATE TABLE "song_submissions" (
    "id" TEXT NOT NULL,
    "youtube_video_id" TEXT NOT NULL,
    "video_title" TEXT NOT NULL,
    "channel_title" TEXT NOT NULL,
    "thumbnail_url" TEXT NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "artist_name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "submitter_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "warning" TEXT NOT NULL DEFAULT '',
    "review_note" TEXT NOT NULL DEFAULT '',
    "song_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "song_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "song_submissions_status_created_at_idx" ON "song_submissions"("status", "created_at");

-- CreateIndex
CREATE INDEX "song_submissions_youtube_video_id_idx" ON "song_submissions"("youtube_video_id");
