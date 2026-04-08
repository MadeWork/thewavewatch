
-- Deactivate broken duplicate Euronews source
UPDATE public.sources SET active = false WHERE id = 'b60157bd-1b92-4704-8635-41192fab2277';

-- Add Google News feed for Euronews energy coverage
INSERT INTO public.sources
  (name, domain, rss_url, region, country_code, language, active, health_status, consecutive_failures, fetch_priority, source_type)
VALUES
  ('Google News: Euronews Energy',
   'news.google.com',
   'https://news.google.com/rss/search?q=%22wave+energy%22+OR+%22marine+energy%22+OR+%22CorPower%22+site:euronews.com&hl=en&gl=GB&ceid=GB:en',
   'europe', 'GB', 'en', true, 'healthy', 0, 95, 'rss')
ON CONFLICT (rss_url) DO NOTHING;
