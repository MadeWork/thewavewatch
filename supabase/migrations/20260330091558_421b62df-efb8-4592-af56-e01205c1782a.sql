ALTER TABLE public.articles 
  ADD COLUMN IF NOT EXISTS relevance_label text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS relevance_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS key_themes text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.articles(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_duplicate boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS articles_enrichment_queue 
  ON public.articles(fetched_at ASC) 
  WHERE is_enriched = false AND is_duplicate = false;

CREATE INDEX IF NOT EXISTS articles_feed_query
  ON public.articles(published_at DESC, relevance_label)
  WHERE is_duplicate = false;

ALTER TABLE public.monitored_topics
  ADD COLUMN IF NOT EXISTS min_relevance_label text DEFAULT 'medium';