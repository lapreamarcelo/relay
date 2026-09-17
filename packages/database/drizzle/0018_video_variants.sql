ALTER TABLE video_project ADD COLUMN IF NOT EXISTS client_request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS video_project_request_idx ON video_project(owner_id,client_request_id) WHERE client_request_id IS NOT NULL;
