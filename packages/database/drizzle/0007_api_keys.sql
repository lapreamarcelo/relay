CREATE TABLE IF NOT EXISTS "api_key" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_key_hash_unique" ON "api_key" ("key_hash");
CREATE INDEX IF NOT EXISTS "api_key_owner_created_idx" ON "api_key" ("owner_id", "created_at");

ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "client_request_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "post_owner_client_request_unique" ON "post" ("owner_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;
