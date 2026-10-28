ALTER TABLE slideshow_project ADD COLUMN IF NOT EXISTS output jsonb NOT NULL DEFAULT '{"format":"images"}'::jsonb;
