-- CreateTable
CREATE TABLE "error_reports" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "nickname" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "route" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "env" JSONB NOT NULL,
    "logs" JSONB NOT NULL,
    "log_count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "admin_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "error_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_reports_status_created_at_idx" ON "error_reports"("status", "created_at");
