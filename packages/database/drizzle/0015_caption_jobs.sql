ALTER TABLE video_render_job ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'render';
ALTER TABLE video_render_job ADD COLUMN IF NOT EXISTS captions jsonb;
ALTER TABLE video_render_job DROP CONSTRAINT IF EXISTS video_render_job_project_id_revision_key;
CREATE UNIQUE INDEX IF NOT EXISTS video_render_job_revision_kind_idx ON video_render_job(project_id,revision,kind);
