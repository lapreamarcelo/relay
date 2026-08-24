ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "publishing_defaults" jsonb DEFAULT '{"instagram":{"imagePublishType":"feed","videoPublishType":"reel"},"facebook":{"videoPublishType":"reel"},"tiktok":{"privacyLevel":"SELF_ONLY","allowComments":true,"allowDuet":false,"allowStitch":false},"youtube":{"privacyStatus":"public","madeForKids":false}}'::jsonb NOT NULL;

UPDATE "user"
SET "publishing_defaults" = '{"instagram":{"imagePublishType":"feed","videoPublishType":"reel"},"facebook":{"videoPublishType":"reel"},"tiktok":{"privacyLevel":"SELF_ONLY","allowComments":true,"allowDuet":false,"allowStitch":false},"youtube":{"privacyStatus":"public","madeForKids":false}}'::jsonb
WHERE "publishing_defaults" IS NULL OR jsonb_typeof("publishing_defaults") <> 'object';

UPDATE "api_key"
SET "scopes" = "scopes" || '["brands:write","settings:read","settings:write"]'::jsonb
WHERE NOT ("scopes" ? 'settings:write');
