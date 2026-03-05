-- Add S3 key for pre-generation output image (for job list display)
ALTER TABLE "videitos"."Job" ADD COLUMN IF NOT EXISTS "preGenImageKey" TEXT;
