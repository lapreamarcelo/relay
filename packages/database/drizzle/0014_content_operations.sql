CREATE TABLE IF NOT EXISTS publishing_queue (
 account_id text PRIMARY KEY REFERENCES social_account(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 timezone text NOT NULL DEFAULT 'UTC', slots jsonb NOT NULL DEFAULT '[]', paused boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS content_idea (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 brand_id text REFERENCES brand(id) ON DELETE SET NULL,
 title text NOT NULL, notes text NOT NULL DEFAULT '', source_url text NOT NULL DEFAULT '',
 pillar text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'idea' CHECK(status IN ('idea','planned','used','archived')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE brand ADD COLUMN IF NOT EXISTS creative_kit jsonb NOT NULL DEFAULT '{}';
