-- Earlier refresh handling treated every Google 400/401/403 response as a
-- revoked token. Give each affected YouTube credential one retry after the
-- provider error classification is corrected. The metadata marker keeps this
-- migration idempotent because Relay reapplies all migration files at startup.
UPDATE "social_account"
SET
  "status" = 'warning',
  "refresh_after_at" = NOW(),
  "provider_metadata" = "provider_metadata" || '{"youtubeRefreshClassificationV2":true}'::jsonb,
  "refresh_lease_owner" = NULL,
  "refresh_lease_expires_at" = NULL,
  "updated_at" = NOW()
WHERE
  "provider" = 'youtube'
  AND "status" = 'expired'
  AND "refresh_token_encrypted" IS NOT NULL
  AND NOT ("provider_metadata" ? 'youtubeRefreshClassificationV2');
