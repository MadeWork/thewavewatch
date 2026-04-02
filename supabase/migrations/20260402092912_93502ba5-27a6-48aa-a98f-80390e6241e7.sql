-- Fix RSS URLs (skip thelocal.com to avoid unique constraint conflict with thelocal.de)
UPDATE public.sources SET rss_url = 'https://news.google.com/rss/search?q=when:24h+allinurl:reuters.com&ceid=US:en&hl=en-US&gl=US', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'reuters.com';
UPDATE public.sources SET rss_url = 'https://feeds.thelocal.com/rss/de', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'thelocal.de';
UPDATE public.sources SET rss_url = 'https://feeds.thelocal.com/rss/fr', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'thelocal.fr';
UPDATE public.sources SET rss_url = 'https://feeds.thelocal.com/rss/es', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'thelocal.es';
UPDATE public.sources SET rss_url = 'https://feeds.thelocal.com/rss/it', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'thelocal.it';
UPDATE public.sources SET rss_url = 'https://feeds.thelocal.com/rss/se', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'thelocal.se';
UPDATE public.sources SET rss_url = 'https://feeds.thelocal.com/rss/no', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'thelocal.no';
UPDATE public.sources SET rss_url = 'https://feeds.thelocal.com/rss/dk', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'thelocal.dk';
UPDATE public.sources SET rss_url = 'https://feeds.thelocal.com/rss/at', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'thelocal.at';
-- Deactivate thelocal.com (duplicate of thelocal.de)
UPDATE public.sources SET active = false WHERE domain = 'thelocal.com';
UPDATE public.sources SET rss_url = 'https://www.nyteknik.se/energi/?service=rss', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'nyteknik.se';
UPDATE public.sources SET rss_url = 'https://www.svd.se/feed/articles.rss', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'svd.se';
UPDATE public.sources SET rss_url = 'https://www.svt.se/nyheter/rss.xml', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'svt.se';
UPDATE public.sources SET rss_url = 'https://www.berlingske.dk/rss/allenyheder', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'berlingske.dk';
UPDATE public.sources SET rss_url = 'https://www.volkskrant.nl/nieuws-achtergrond/rss.xml', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'volkskrant.nl';
UPDATE public.sources SET rss_url = 'https://www.dagbladet.no/nyheter/rss2.xml', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'dagbladet.no';
UPDATE public.sources SET rss_url = 'https://www.tu.no/rss/alle-nyheter', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'tu.no';
UPDATE public.sources SET rss_url = 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'wsj.com';
UPDATE public.sources SET rss_url = 'https://finance.yahoo.com/news/rssindex', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'finance.yahoo.com';
UPDATE public.sources SET rss_url = 'https://e360.yale.edu/feed', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'e360.yale.edu';
UPDATE public.sources SET rss_url = 'https://feeds.feedburner.com/euronews/en/green/', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'euronews.com';
UPDATE public.sources SET rss_url = 'https://www.france24.com/en/rss', consecutive_failures = 0, health_status = 'healthy' WHERE domain = 'france24.com';

-- Disable broken domains
UPDATE public.sources SET active = false WHERE domain IN ('vice.com','buzzfeednews.com','britannica.com','tracxn.com','tipranks.com','bestcolleges.com','openpr.com','newswire.ca','news.cision.com','newsroom.cisco.com','sustainabilitymag.com','globalenergyprize.org','calpoly.edu','fau.edu','lboro.ac.uk','dailyuw.com','mainebiz.biz');

-- Clean corrupted expanded_terms with Chinese characters
UPDATE public.keywords SET expanded_terms = '{}'::text[] WHERE expanded_terms IS NOT NULL AND expanded_terms::text ~ '[\u4e00-\u9fff]';