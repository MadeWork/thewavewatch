
-- Add importance, confidence, and story_cluster_id to articles
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS importance text DEFAULT 'medium';
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS confidence double precision DEFAULT NULL;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS story_cluster_id uuid DEFAULT NULL;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS matched_reason text DEFAULT NULL;
