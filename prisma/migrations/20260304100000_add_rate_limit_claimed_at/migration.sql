-- AlterTable
ALTER TABLE "videitos"."Job" ADD COLUMN IF NOT EXISTS "rateLimitClaimedAt" TIMESTAMP(3);
