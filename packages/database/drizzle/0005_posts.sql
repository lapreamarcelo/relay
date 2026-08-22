CREATE TABLE IF NOT EXISTS "post" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "brand_id" text REFERENCES "brand"("id") ON DELETE SET NULL,
  "text" text NOT NULL,
  "media_type" text DEFAULT 'none' NOT NULL,
  "media_url" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "scheduled_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "post_media_type_check" CHECK ("media_type" IN ('none', 'image', 'video')),
  CONSTRAINT "post_status_check" CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  CONSTRAINT "post_content_check" CHECK (length(trim("text")) > 0 OR "media_url" IS NOT NULL),
  CONSTRAINT "post_schedule_check" CHECK ("status" <> 'scheduled' OR "scheduled_at" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "post_target" (
  "id" text PRIMARY KEY NOT NULL,
  "post_id" text NOT NULL REFERENCES "post"("id") ON DELETE CASCADE,
  "social_account_id" text REFERENCES "social_account"("id") ON DELETE SET NULL,
  "provider" text NOT NULL,
  "account_display_name" text NOT NULL,
  "account_handle" text NOT NULL,
  "status" text NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "external_url" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "post_target_provider_check" CHECK ("provider" IN ('instagram', 'facebook', 'tiktok', 'youtube')),
  CONSTRAINT "post_target_status_check" CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  CONSTRAINT "post_target_settings_check" CHECK (jsonb_typeof("settings") = 'object')
);

CREATE INDEX IF NOT EXISTS "post_owner_created_idx" ON "post" ("owner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "post_owner_scheduled_idx" ON "post" ("owner_id", "scheduled_at") WHERE "scheduled_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "post_owner_published_idx" ON "post" ("owner_id", "published_at" DESC) WHERE "published_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "post_brand_id_idx" ON "post" ("brand_id");
CREATE INDEX IF NOT EXISTS "post_target_post_id_idx" ON "post_target" ("post_id");
CREATE INDEX IF NOT EXISTS "post_target_social_account_id_idx" ON "post_target" ("social_account_id");
