-- Fix Google News articles: extract source_name from title and map to domains
UPDATE articles
SET source_name = trim(substring(title from ' - ([^-]+)$'))
WHERE source_domain = 'news.google.com'
  AND title LIKE '% - %'
  AND (source_name IS NULL OR source_name = 'news.google.com' OR source_name = 'Google News' OR source_name = '');

UPDATE articles SET source_domain = 'offshore-energy.biz', is_major_outlet = false
WHERE source_domain = 'news.google.com' AND source_name = 'Offshore-Energy.biz';

UPDATE articles SET source_domain = 'renews.biz', is_major_outlet = false
WHERE source_domain = 'news.google.com' AND source_name IN ('reNEWS', 'reNews');

UPDATE articles SET source_domain = 'nature.com', is_major_outlet = true
WHERE source_domain = 'news.google.com' AND source_name = 'Nature';

UPDATE articles SET source_domain = 'bbc.co.uk', is_major_outlet = true
WHERE source_domain = 'news.google.com' AND source_name IN ('BBC', 'BBC News');

UPDATE articles SET source_domain = 'theguardian.com', is_major_outlet = true
WHERE source_domain = 'news.google.com' AND source_name = 'The Guardian';

UPDATE articles SET source_domain = 'reuters.com', is_major_outlet = true
WHERE source_domain = 'news.google.com' AND source_name = 'Reuters';

UPDATE articles SET source_domain = 'euronews.com', is_major_outlet = true
WHERE source_domain = 'news.google.com' AND source_name = 'Euronews';

UPDATE articles SET source_domain = 'heraldscotland.com', is_major_outlet = true
WHERE source_domain = 'news.google.com' AND source_name IN ('Herald Scotland', 'HeraldScotland');

UPDATE articles SET source_domain = 'scotsman.com', is_major_outlet = true
WHERE source_domain = 'news.google.com' AND source_name = 'The Scotsman';

UPDATE articles SET source_domain = 'forbes.com', is_major_outlet = true
WHERE source_domain = 'news.google.com' AND source_name = 'Forbes';

UPDATE articles SET source_domain = 'cnbc.com', is_major_outlet = true
WHERE source_domain = 'news.google.com' AND source_name = 'CNBC';