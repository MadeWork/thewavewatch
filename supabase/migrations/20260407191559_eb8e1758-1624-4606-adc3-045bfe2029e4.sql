-- Backfill source_domain from url
UPDATE articles
SET source_domain = regexp_replace(
  regexp_replace(url, '^https?://(www\.)?', ''),
  '/.*$', ''
)
WHERE (source_domain IS NULL OR source_domain = '')
  AND url IS NOT NULL;

-- Fix is_major_outlet based on corrected source_domain
UPDATE articles
SET is_major_outlet = true
WHERE source_domain IN (
  'reuters.com','apnews.com','bloomberg.com','afp.com',
  'nytimes.com','washingtonpost.com','wsj.com','ft.com',
  'cnbc.com','cnn.com','bbc.com','bbc.co.uk','theguardian.com',
  'euronews.com','euractiv.com','politico.eu','politico.com',
  'spiegel.de','faz.net','sueddeutsche.de','dw.com','handelsblatt.com',
  'lemonde.fr','lefigaro.fr','elpais.com',
  'heraldscotland.com','scotsman.com','pressandjournal.co.uk',
  'telegraph.co.uk','independent.co.uk','sky.com','thetimes.co.uk',
  'dn.se','svd.se','di.se','aftenposten.no','dn.no','vg.no','nrk.no',
  'berlingske.dk','politiken.dk','yle.fi',
  'abc.net.au','smh.com.au','nzherald.co.nz','stuff.co.nz','rnz.co.nz',
  'carbonbrief.org','energymonitor.ai',
  'npr.org','forbes.com','time.com','theatlantic.com'
)
AND (is_major_outlet = false OR is_major_outlet IS NULL);