-- Fix remaining articles with null source_name
UPDATE articles
SET source_name = trim(substring(title from ' - ([^-]+)$'))
WHERE source_domain = 'news.google.com'
  AND title LIKE '% - %'
  AND source_name IS NULL;

-- Clean titles: remove " - Source Name" suffix for all google news articles
UPDATE articles
SET title = trim(substring(title from '^(.*) - [^-]+$'))
WHERE source_domain = 'news.google.com'
  AND title LIKE '% - %'
  AND title = trim(substring(title from '^(.*) - [^-]+$')) || ' - ' || trim(substring(title from ' - ([^-]+)$'));