CREATE TABLE IF NOT EXISTS "campaign" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "brand_id" text REFERENCES "brand"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "color" text DEFAULT '#ff5c35' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_name_check" CHECK (length(trim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "campaign_color_check" CHECK ("color" ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT "campaign_status_check" CHECK ("status" IN ('active', 'archived'))
);
CREATE INDEX IF NOT EXISTS "campaign_owner_updated_idx" ON "campaign" ("owner_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "campaign_brand_id_idx" ON "campaign" ("brand_id");

ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "campaign_id" text REFERENCES "campaign"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "post_campaign_id_idx" ON "post" ("campaign_id");

ALTER TABLE "post_target" ADD COLUMN IF NOT EXISTS "text_override" text;

CREATE TABLE IF NOT EXISTS "post_template" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "brand_id" text REFERENCES "brand"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "text" text DEFAULT '' NOT NULL,
  "media_type" text DEFAULT 'none' NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "post_template_name_check" CHECK (length(trim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "post_template_media_check" CHECK ("media_type" IN ('none', 'image', 'video')),
  CONSTRAINT "post_template_settings_check" CHECK (jsonb_typeof("settings") = 'object')
);
CREATE INDEX IF NOT EXISTS "post_template_owner_updated_idx" ON "post_template" ("owner_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "post_template_brand_id_idx" ON "post_template" ("brand_id");

CREATE TABLE IF NOT EXISTS "worker_heartbeat" (
  "id" text PRIMARY KEY NOT NULL,
  "worker_id" text NOT NULL,
  "metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "worker_heartbeat_checked_idx" ON "worker_heartbeat" ("checked_at" DESC);
