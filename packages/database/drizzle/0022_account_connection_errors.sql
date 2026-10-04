ALTER TABLE "social_account" ADD COLUMN IF NOT EXISTS "connection_error" text;

-- Recover Meta sessions rejected before publishing failures updated account health.
-- A successful refresh or reconnect after the failure must take precedence.
UPDATE "social_account" account
SET status = 'expired', connection_error = failure.error, updated_at = NOW()
FROM (
  SELECT DISTINCT ON (social_account_id) social_account_id, error, updated_at
  FROM "post_target"
  WHERE status = 'failed' AND error ILIKE '%Error validating access token%'
  ORDER BY social_account_id, updated_at DESC
) failure
WHERE account.id = failure.social_account_id
  AND account.provider IN ('instagram', 'facebook')
  AND account.connection_error IS NULL
  AND (account.last_checked_at IS NULL OR account.last_checked_at <= failure.updated_at);
