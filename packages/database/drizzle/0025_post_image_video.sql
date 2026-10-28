CREATE TABLE IF NOT EXISTS post_image_video_job (
  id text PRIMARY KEY,
  target_id text NOT NULL REFERENCES post_target(id) ON DELETE CASCADE,
  source_urls jsonb NOT NULL,
  image_seconds integer NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  rendered_url text,
  error text,
  failure_acknowledged_at timestamptz,
  lease_token text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(target_id)
);
CREATE INDEX IF NOT EXISTS post_image_video_queue_idx ON post_image_video_job(status, created_at);
