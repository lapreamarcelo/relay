ALTER TABLE video_project ADD COLUMN IF NOT EXISTS rendered_cover_url text;
ALTER TABLE video_render_job ADD COLUMN IF NOT EXISTS cover_url text;
