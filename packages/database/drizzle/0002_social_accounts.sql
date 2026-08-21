CREATE TABLE IF NOT EXISTS "social_account" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "brand_id" text NOT NULL REFERENCES "brand"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "auth_method" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "username" text NOT NULL,
  "display_name" text NOT NULL,
  "avatar_url" text,
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text,
  "token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "refresh_after_at" timestamp with time zone,
  "granted_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'connected' NOT NULL,
  "last_checked_at" timestamp with time zone,
  "refresh_lease_owner" text,
  "refresh_lease_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_account_status_check" CHECK ("status" IN ('connected', 'warning', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_account_provider_unique"
  ON "social_account" ("owner_id", "provider", "provider_account_id");
CREATE INDEX IF NOT EXISTS "social_account_owner_id_idx" ON "social_account" ("owner_id");
CREATE INDEX IF NOT EXISTS "social_account_brand_id_idx" ON "social_account" ("brand_id");
CREATE INDEX IF NOT EXISTS "social_account_refresh_due_idx"
  ON "social_account" ("refresh_after_at") WHERE "status" <> 'expired';
