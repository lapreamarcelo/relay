ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "provider_post_id" text;
ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "publish_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "publish_after" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "publish_lease_owner" text;
ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "publish_lease_expires_at" timestamp with time zone;

ALTER TABLE "post" DROP CONSTRAINT IF EXISTS "post_status_check";
ALTER TABLE "post" ADD CONSTRAINT "post_status_check" CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'processing', 'published', 'failed'));
ALTER TABLE "post_target" DROP CONSTRAINT IF EXISTS "post_target_status_check";
ALTER TABLE "post_target" ADD CONSTRAINT "post_target_status_check" CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'processing', 'published', 'failed'));

CREATE INDEX IF NOT EXISTS "post_target_publish_due_idx"
  ON "post_target" ("publish_after")
  WHERE "status" IN ('scheduled', 'publishing', 'processing');
