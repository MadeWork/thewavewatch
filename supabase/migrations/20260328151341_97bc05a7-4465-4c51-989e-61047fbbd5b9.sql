ALTER TABLE public.articles ALTER COLUMN published_at DROP NOT NULL;
ALTER TABLE public.articles ALTER COLUMN published_at DROP DEFAULT;