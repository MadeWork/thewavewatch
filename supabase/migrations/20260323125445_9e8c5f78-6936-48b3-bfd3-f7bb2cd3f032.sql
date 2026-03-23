
-- Create tables for media monitoring app

CREATE TABLE public.keywords (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  text TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  logic_operator TEXT NOT NULL DEFAULT 'OR',
  color_tag TEXT DEFAULT '#5b9cf6',
  match_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  rss_url TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL DEFAULT 'global',
  country_code TEXT DEFAULT 'GB',
  active BOOLEAN NOT NULL DEFAULT true,
  last_fetched_at TIMESTAMPTZ,
  health_status TEXT NOT NULL DEFAULT 'healthy',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.articles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  snippet TEXT,
  url TEXT NOT NULL UNIQUE,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sentiment TEXT DEFAULT 'neutral',
  sentiment_score FLOAT DEFAULT 0.5,
  matched_keywords TEXT[] DEFAULT '{}',
  language TEXT DEFAULT 'en',
  ai_summary TEXT
);

CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT DEFAULT 'My Company',
  company_logo_url TEXT,
  digest_email TEXT,
  fetch_frequency_minutes INTEGER DEFAULT 60,
  language_filter TEXT[] DEFAULT '{}',
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_articles_published_at ON public.articles(published_at DESC);
CREATE INDEX idx_articles_source_id ON public.articles(source_id);
CREATE INDEX idx_keywords_text ON public.keywords(text);

-- Enable RLS
ALTER TABLE public.keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- RLS policies: authenticated users get full access
CREATE POLICY "Authenticated users full access" ON public.keywords FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.sources FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.articles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
