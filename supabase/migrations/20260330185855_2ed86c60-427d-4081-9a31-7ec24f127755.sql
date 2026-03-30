
-- Add unique constraint for article deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_topic_ext_source 
ON public.articles (topic_id, external_id, ingestion_source);

-- Add index for major outlet filtering
CREATE INDEX IF NOT EXISTS idx_articles_major_only 
ON public.articles (is_major_outlet) WHERE is_major_outlet = TRUE;
