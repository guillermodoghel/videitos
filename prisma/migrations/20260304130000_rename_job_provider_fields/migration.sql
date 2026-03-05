-- Rename Job columns to be provider-agnostic (Veo/Runway)
ALTER TABLE "videitos"."Job" RENAME COLUMN "veoOperationName" TO "providerOperationId";
ALTER TABLE "videitos"."Job" RENAME COLUMN "sentToVeoAt" TO "sentAt";
