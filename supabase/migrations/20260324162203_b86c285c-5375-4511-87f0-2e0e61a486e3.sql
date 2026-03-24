
-- Clean up tag-like snippets from sitemap discovery (these are news:keywords, not real excerpts)
UPDATE articles SET snippet = NULL WHERE discovery_method = 'sitemap' AND snippet IS NOT NULL AND snippet LIKE '%,%,%,%' AND LENGTH(snippet) < 200;

-- Clean up HTML entities in existing snippets
UPDATE articles SET snippet = REPLACE(snippet, '&#160;', ' ') WHERE snippet LIKE '%&#160;%';
UPDATE articles SET title = REPLACE(title, '&#160;', ' ') WHERE title LIKE '%&#160;%';

-- Remove duplicate articles (keep the one with the better snippet)
DELETE FROM articles a
USING articles b
WHERE a.id > b.id
  AND TRIM(TRAILING '/' FROM a.url) = TRIM(TRAILING '/' FROM b.url)
  AND a.title = b.title;
