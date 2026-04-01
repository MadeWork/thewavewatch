-- Clean corrupted Chinese-character terms from expanded_terms
UPDATE public.keywords
SET expanded_terms = (
  SELECT array_agg(val)
  FROM unnest(expanded_terms) AS val
  WHERE val !~ '[基开发转换]'
    AND val ~ '^[a-zA-Z0-9 \-\/\.\,\(\)]+$'
)
WHERE expanded_terms IS NOT NULL;

-- Add Euronews Green and Next section feeds
INSERT INTO public.sources
  (name, rss_url, domain, region, country_code, active, approval_status, language, fetch_priority, health_status, consecutive_failures)
VALUES
  ('Euronews Green', 'https://feeds.feedburner.com/euronews/en/green/', 'euronews.com', 'europe', 'EU', true, 'approved', 'en', 80, 'healthy', 0),
  ('Euronews Next', 'https://feeds.feedburner.com/euronews/en/next/', 'euronews.com', 'europe', 'EU', true, 'approved', 'en', 80, 'healthy', 0)
ON CONFLICT DO NOTHING;

-- Update existing Euronews entry if it has no feed
UPDATE public.sources
SET rss_url = 'https://feeds.feedburner.com/euronews/en/home/'
WHERE domain = 'euronews.com' AND (rss_url IS NULL OR rss_url = '');