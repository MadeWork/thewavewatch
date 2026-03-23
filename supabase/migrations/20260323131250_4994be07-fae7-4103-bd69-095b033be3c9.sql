
ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'rss',
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS parser_config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS robots_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS crawl_delay_ms integer NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;
