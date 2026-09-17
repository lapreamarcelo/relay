CREATE TABLE IF NOT EXISTS campaign_recipe(id text PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,name text NOT NULL,entries jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS client_request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_request_idx ON campaign(owner_id,client_request_id) WHERE client_request_id IS NOT NULL;
