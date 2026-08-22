CREATE TABLE IF NOT EXISTS "notification" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "event_key" text NOT NULL,
  "post_id" text,
  "target_id" text,
  "provider" text,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "external_url" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_kind_check" CHECK ("kind" IN ('success', 'error', 'scheduled', 'info')),
  CONSTRAINT "notification_provider_check" CHECK ("provider" IS NULL OR "provider" IN ('instagram', 'facebook', 'tiktok', 'youtube'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_owner_event_unique"
  ON "notification" ("owner_id", "event_key");
CREATE INDEX IF NOT EXISTS "notification_owner_created_idx"
  ON "notification" ("owner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notification_owner_unread_idx"
  ON "notification" ("owner_id", "created_at" DESC) WHERE "read_at" IS NULL;
