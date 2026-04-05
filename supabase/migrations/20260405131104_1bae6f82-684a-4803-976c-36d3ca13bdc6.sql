ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS articles_era text CHECK (articles_era IN ('live','recent','archive')) DEFAULT 'live';

CREATE INDEX IF NOT EXISTS articles_era_idx ON public.articles(articles_era);

CREATE INDEX IF NOT EXISTS articles_published_at_idx ON public.articles(published_at DESC);