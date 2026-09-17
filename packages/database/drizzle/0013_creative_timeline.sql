ALTER TABLE video_project ADD COLUMN IF NOT EXISTS timeline jsonb;
ALTER TABLE video_project ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE video_project ADD COLUMN IF NOT EXISTS template_id text;
CREATE TABLE IF NOT EXISTS video_render_job (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 project_id text NOT NULL REFERENCES video_project(id) ON DELETE CASCADE,
 revision integer NOT NULL, snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
 progress integer NOT NULL DEFAULT 0, rendered_url text, error text,
 attempts integer NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,revision)
);
CREATE INDEX IF NOT EXISTS video_render_queue_idx ON video_render_job(status,created_at);
CREATE TABLE IF NOT EXISTS creative_template (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 name text NOT NULL, description text NOT NULL DEFAULT '', timeline jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
