-- Remove templates using the removed native Veo 3.1 Fast model (jobs cascade-delete)
DELETE FROM "videitos"."Template"
WHERE "model" = 'veo-3.1-fast-generate-preview';
