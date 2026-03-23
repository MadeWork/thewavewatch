
-- Add author fields to articles table
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS author_name text;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS author_email text;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS author_url text;

-- Create enrichment cache table for on-demand deep data
CREATE TABLE public.article_enrichments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  author_name text,
  author_email text,
  author_url text,
  author_bio text,
  author_social jsonb DEFAULT '{}',
  comments jsonb DEFAULT '[]',
  full_text text,
  key_quotes text[],
  enriched_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(article_id)
);

ALTER TABLE public.article_enrichments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read article_enrichments" ON public.article_enrichments
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated write article_enrichments" ON public.article_enrichments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated update article_enrichments" ON public.article_enrichments
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
