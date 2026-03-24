
ALTER TABLE public.articles 
  ADD COLUMN IF NOT EXISTS discovery_method text DEFAULT 'rss',
  ADD COLUMN IF NOT EXISTS relevance_score double precision DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS primary_entity text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS matched_via text DEFAULT NULL;
