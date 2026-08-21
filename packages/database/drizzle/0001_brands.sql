CREATE TABLE IF NOT EXISTS "brand" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "monogram" text NOT NULL,
  "color" text NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "brand_owner_id_idx" ON "brand" ("owner_id");
