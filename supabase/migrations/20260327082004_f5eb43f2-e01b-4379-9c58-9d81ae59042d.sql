
-- Add source_category to articles (media by default)
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS source_category text NOT NULL DEFAULT 'media';

-- Add monitor_in_media and monitor_in_social to keywords
ALTER TABLE public.keywords ADD COLUMN IF NOT EXISTS monitor_in_media boolean NOT NULL DEFAULT true;
ALTER TABLE public.keywords ADD COLUMN IF NOT EXISTS monitor_in_social boolean NOT NULL DEFAULT false;

-- Add alert_category to alert_rules
ALTER TABLE public.alert_rules ADD COLUMN IF NOT EXISTS alert_category text NOT NULL DEFAULT 'media';
