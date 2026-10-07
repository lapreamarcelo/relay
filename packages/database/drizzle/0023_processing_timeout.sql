ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp with time zone;

-- The old timeout used row creation time and could fail scheduled posts on
-- their first status poll. Reconcile existing provider sessions without
-- uploading the media again. The timestamp makes this recovery run once even
-- though Relay reapplies migration files on each startup.
UPDATE "post_target"
SET "status" = 'processing', "processing_started_at" = NOW(),
  "publish_attempts" = 0, "publish_after" = NOW(), "error" = NULL,
  "publish_lease_owner" = NULL, "publish_lease_expires_at" = NULL, "updated_at" = NOW()
WHERE "status" = 'failed'
  AND "error" = 'The provider did not finish processing this post within 24 hours.'
  AND "provider_post_id" IS NOT NULL
  AND "processing_started_at" IS NULL;

-- Remove the obsolete failure notice so any actual provider rejection found
-- during reconciliation can create a fresh notification for this target.
DELETE FROM "notification" n
WHERE n.kind = 'error'
  AND n.message = 'The provider did not finish processing this post within 24 hours.'
  AND EXISTS (SELECT 1 FROM "post_target" t WHERE t.id = n.target_id
    AND t.status = 'processing' AND t.processing_started_at IS NOT NULL AND t.error IS NULL);

UPDATE "post"
SET "status" = 'processing', "updated_at" = NOW()
WHERE "status" = 'failed'
  AND EXISTS (SELECT 1 FROM "post_target" t WHERE t.post_id = "post".id AND t.status = 'processing')
  AND NOT EXISTS (SELECT 1 FROM "post_target" t WHERE t.post_id = "post".id AND t.status = 'publishing');
