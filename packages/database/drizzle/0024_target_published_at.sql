ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "published_at" timestamp with time zone;

-- A parent's publication timestamp is available only once all destinations
-- succeed. For older partial publications, updated_at is the closest retained
-- publication evidence; creation time may belong to a months-old draft.
UPDATE "post_target" target
SET "published_at" = COALESCE(post.published_at, target.updated_at)
FROM "post" post
WHERE post.id = target.post_id AND target.status = 'published' AND target.published_at IS NULL;
