-- CreateTable
CREATE TABLE "speedrun_scores" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "total_time_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "speedrun_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "speedrun_scores_total_time_ms_idx" ON "speedrun_scores"("total_time_ms");
