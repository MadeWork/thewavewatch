
-- Fix legacy Reuters articles with no URL-extractable dates
UPDATE public.articles SET published_at = '2009-05-05T12:00:00Z' WHERE id = 'db0ca021-d8d8-49c5-8571-b275be8ee634';
UPDATE public.articles SET published_at = '2012-01-11T12:00:00Z' WHERE id = 'fe1edb67-610e-48db-a26f-3f53c5778b82';
-- Fix Tech watch article (also has wrong date)
UPDATE public.articles SET published_at = '2011-01-12T12:00:00Z' WHERE id = '4bd3f3c8-e11a-47f0-a769-4af9b0aef660';
