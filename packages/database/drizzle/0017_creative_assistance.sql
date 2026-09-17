CREATE TABLE IF NOT EXISTS creative_assistance_request (id text PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS creative_assistance_owner_time_idx ON creative_assistance_request(owner_id,created_at);
