DELETE FROM article_enrichments WHERE article_id IN (SELECT id FROM articles WHERE published_at < now() - interval '30 days');
DELETE FROM article_bookmarks WHERE article_id IN (SELECT id FROM articles WHERE published_at < now() - interval '30 days');
DELETE FROM article_tags WHERE article_id IN (SELECT id FROM articles WHERE published_at < now() - interval '30 days');
DELETE FROM article_notes WHERE article_id IN (SELECT id FROM articles WHERE published_at < now() - interval '30 days');
DELETE FROM articles WHERE published_at < now() - interval '30 days';