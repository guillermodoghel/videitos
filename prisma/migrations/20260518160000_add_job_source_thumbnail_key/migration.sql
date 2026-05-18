-- AlterTable (idempotent — safe if a previous deploy partially applied this)
ALTER TABLE "videitos"."Job" ADD COLUMN IF NOT EXISTS "sourceThumbnailKey" TEXT;
