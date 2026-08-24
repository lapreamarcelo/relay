CREATE TABLE IF NOT EXISTS "video_project" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "brand_id" text REFERENCES "brand"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "caption" text DEFAULT '' NOT NULL,
  "source_url" text DEFAULT '' NOT NULL,
  "source_folder_id" text,
  "music_url" text,
  "music_folder_id" text,
  "labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rendered_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "video_project_name_check" CHECK (length(trim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "video_project_labels_check" CHECK (jsonb_typeof("labels") = 'array' AND jsonb_array_length("labels") <= 12)
);

CREATE INDEX IF NOT EXISTS "video_project_owner_updated_idx" ON "video_project" ("owner_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "video_project_brand_id_idx" ON "video_project" ("brand_id");

UPDATE "api_key"
SET "scopes" = "scopes" || '["media:write", "analytics:read", "analytics:write", "videos:read", "videos:write"]'::jsonb
WHERE NOT ("scopes" ? 'videos:write');

CREATE TABLE IF NOT EXISTS "analytics_report_schedule" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "cadence" text NOT NULL,
  "filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "last_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "analytics_report_name_check" CHECK (length(trim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "analytics_report_cadence_check" CHECK ("cadence" IN ('weekly', 'monthly')),
  CONSTRAINT "analytics_report_filters_check" CHECK (jsonb_typeof("filters") = 'object')
);
CREATE INDEX IF NOT EXISTS "analytics_report_due_idx" ON "analytics_report_schedule" ("next_run_at");
