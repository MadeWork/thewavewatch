
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS is_major_outlet BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_articles_major_outlet ON public.articles(is_major_outlet) WHERE is_major_outlet = TRUE;
