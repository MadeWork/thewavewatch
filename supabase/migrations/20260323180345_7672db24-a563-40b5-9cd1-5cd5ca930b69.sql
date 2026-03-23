ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS source_name text;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS source_domain text;