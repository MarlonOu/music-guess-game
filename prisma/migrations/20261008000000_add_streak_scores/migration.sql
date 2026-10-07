-- CreateTable
CREATE TABLE "streak_scores" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "streak" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "streak_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "streak_scores_streak_score_idx" ON "streak_scores"("streak", "score");
