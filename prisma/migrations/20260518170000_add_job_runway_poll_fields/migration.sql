-- AlterTable
ALTER TABLE "videitos"."Job" ADD COLUMN IF NOT EXISTS "runwayProgress" DOUBLE PRECISION;
ALTER TABLE "videitos"."Job" ADD COLUMN IF NOT EXISTS "runwayPollStatus" TEXT;
