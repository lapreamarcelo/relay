ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "post" DROP CONSTRAINT IF EXISTS "post_media_urls_check";
ALTER TABLE "post" ADD CONSTRAINT "post_media_urls_check" CHECK (
  jsonb_typeof("media_urls") = 'array' AND jsonb_array_length("media_urls") <= 35
);

UPDATE "post"
SET "media_urls" = jsonb_build_array("media_url")
WHERE "media_url" IS NOT NULL AND jsonb_array_length("media_urls") = 0;

CREATE TABLE IF NOT EXISTS "slideshow_project" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "brand_id" text REFERENCES "brand"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "caption" text DEFAULT '' NOT NULL,
  "slides" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slideshow_project_name_check" CHECK (length(trim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "slideshow_project_slides_check" CHECK (jsonb_typeof("slides") = 'array' AND jsonb_array_length("slides") <= 35)
);

CREATE INDEX IF NOT EXISTS "slideshow_project_owner_updated_idx" ON "slideshow_project" ("owner_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "slideshow_project_brand_id_idx" ON "slideshow_project" ("brand_id");

UPDATE "api_key"
SET "scopes" = "scopes" || '["media:read", "slideshows:read", "slideshows:write"]'::jsonb
WHERE NOT ("scopes" ? 'slideshows:write');
