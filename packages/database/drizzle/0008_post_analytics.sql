CREATE TABLE IF NOT EXISTS "post_metric_snapshot" (
  "id" text PRIMARY KEY NOT NULL,
  "target_id" text NOT NULL REFERENCES "post_target"("id") ON DELETE CASCADE,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "views" bigint,
  "reach" bigint,
  "likes" bigint,
  "comments" bigint,
  "shares" bigint,
  "saves" bigint,
  "watch_time_seconds" bigint,
  "average_watch_time_seconds" integer,
  "raw_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "post_metric_target_captured_idx" ON "post_metric_snapshot" ("target_id", "captured_at" DESC);

ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "analytics_after" timestamp with time zone;
ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "analytics_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "analytics_last_error" text;
ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "analytics_lease_owner" text;
ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "analytics_lease_expires_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "post_target_analytics_due_idx" ON "post_target" ("analytics_after") WHERE "status" = 'published';

UPDATE "post_target" SET "analytics_after" = now()
WHERE "status" = 'published' AND "analytics_after" IS NULL AND "provider_post_id" IS NOT NULL;
