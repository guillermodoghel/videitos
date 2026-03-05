-- Rename status value: sent_to_veo → processing (model-agnostic)
UPDATE "videitos"."Job" SET "status" = 'processing' WHERE "status" = 'sent_to_veo';
