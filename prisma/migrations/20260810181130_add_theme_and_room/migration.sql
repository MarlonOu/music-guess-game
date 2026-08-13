-- CreateTable
CREATE TABLE "themes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "song_themes" (
    "song_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,

    CONSTRAINT "song_themes_pkey" PRIMARY KEY ("song_id","theme_id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "join_code" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "artist_filter_ids" TEXT[],
    "theme_filter_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'lobby',
    "song_queue" TEXT[],
    "clip_start_secs" INTEGER[],
    "lyric_line_indexes" INTEGER[],
    "current_round_index" INTEGER NOT NULL DEFAULT 0,
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "round_started_at" TIMESTAMP(3),
    "host_player_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_players" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_messages" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "is_correct_answer" BOOLEAN NOT NULL DEFAULT false,
    "round_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "song_themes_theme_id_idx" ON "song_themes"("theme_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_join_code_key" ON "rooms"("join_code");

-- CreateIndex
CREATE INDEX "room_players_room_id_idx" ON "room_players"("room_id");

-- CreateIndex
CREATE INDEX "room_messages_room_id_created_at_idx" ON "room_messages"("room_id", "created_at");

-- AddForeignKey
ALTER TABLE "song_themes" ADD CONSTRAINT "song_themes_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_themes" ADD CONSTRAINT "song_themes_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
