-- AlterTable
ALTER TABLE "songs" ADD COLUMN     "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
