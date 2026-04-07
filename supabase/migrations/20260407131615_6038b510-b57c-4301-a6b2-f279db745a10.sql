ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS engagement_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_count integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS articles_source_category_idx
  ON public.articles(source_category);

CREATE INDEX IF NOT EXISTS articles_ingestion_source_idx
  ON public.articles(ingestion_source);