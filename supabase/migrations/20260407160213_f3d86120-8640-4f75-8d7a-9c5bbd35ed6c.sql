
-- Step 1: Fix priorities for actual major outlets
UPDATE sources SET fetch_priority = 100 WHERE domain IN (
  'reuters.com', 'apnews.com', 'bloomberg.com', 'afp.com',
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com',
  'cnbc.com', 'cnn.com', 'nbcnews.com', 'abcnews.go.com',
  'cbsnews.com', 'npr.org', 'politico.com',
  'theguardian.com', 'bbc.com', 'bbc.co.uk', 'thetimes.co.uk',
  'telegraph.co.uk', 'independent.co.uk', 'sky.com',
  'euronews.com', 'euractiv.com', 'politico.eu',
  'spiegel.de', 'faz.net', 'sueddeutsche.de', 'dw.com',
  'lemonde.fr', 'lefigaro.fr',
  'dn.se', 'svd.se', 'di.se', 'aftonbladet.se', 'expressen.se',
  'aftenposten.no', 'dn.no', 'vg.no', 'nrk.no', 'e24.no',
  'berlingske.dk', 'politiken.dk', 'borsen.dk', 'dr.dk',
  'yle.fi', 'hs.fi',
  'abc.net.au', 'smh.com.au', 'theage.com.au', 'afr.com',
  'theaustralian.com.au', 'news.com.au', 'sbs.com.au',
  'nzherald.co.nz', 'stuff.co.nz', 'rnz.co.nz',
  'carbonbrief.org', 'energymonitor.ai'
);

-- Step 2: Fix priorities for key industry sources
UPDATE sources SET fetch_priority = 90 WHERE domain IN (
  'renews.biz', 'offshore-energy.biz', 'rechargenews.com',
  'oceanenergy-europe.eu', 'emec.org.uk', 'about.bnef.com',
  'bloomberg.com/green'
);

-- Step 3: Demote misclassified sources that got priority 100 due to name matching
UPDATE sources SET fetch_priority = 30 WHERE domain IN (
  'freep.com', 'app.com', 'scottishdailyexpress.co.uk',
  'guernseypress.com', 'newindianexpress.com', 'pressdemocrat.com',
  'cambridge.org', 'domainnamewire.com', 'cmswire.com', 'dredgewire.com',
  'geekwire.com', 'koreabizwire.com', 'saltwire.com', 'telematicswire.net',
  'thebftonline.com', 'thewire.in'
);

-- Step 4: Replace the auto-sync trigger with proper major outlet domain matching
CREATE OR REPLACE FUNCTION public.sync_approved_domain_to_sources()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _priority integer;
  _rss_url text;
  _major_domains text[] := ARRAY[
    'reuters.com','apnews.com','bloomberg.com','afp.com',
    'nytimes.com','washingtonpost.com','wsj.com','ft.com',
    'cnbc.com','cnn.com','nbcnews.com','cbsnews.com','npr.org',
    'theguardian.com','bbc.com','bbc.co.uk','thetimes.co.uk',
    'telegraph.co.uk','independent.co.uk','sky.com',
    'euronews.com','euractiv.com','politico.eu','politico.com',
    'spiegel.de','faz.net','sueddeutsche.de','dw.com',
    'lemonde.fr','lefigaro.fr',
    'dn.se','svd.se','di.se','aftonbladet.se','expressen.se',
    'aftenposten.no','dn.no','vg.no','nrk.no','e24.no',
    'berlingske.dk','politiken.dk','borsen.dk','dr.dk',
    'yle.fi','hs.fi',
    'abc.net.au','smh.com.au','theage.com.au','afr.com',
    'theaustralian.com.au','news.com.au','sbs.com.au',
    'nzherald.co.nz','stuff.co.nz','rnz.co.nz',
    'carbonbrief.org','energymonitor.ai'
  ];
  _industry_domains text[] := ARRAY[
    'renews.biz','offshore-energy.biz','rechargenews.com',
    'oceanenergy-europe.eu','emec.org.uk','about.bnef.com'
  ];
BEGIN
  IF NEW.approval_status = 'approved' THEN
    _rss_url := COALESCE(NEW.feed_url, 'https://' || NEW.domain || '/rss');

    -- Check against curated major outlet list first
    IF NEW.domain = ANY(_major_domains) THEN
      _priority := 100;
    ELSIF NEW.domain = ANY(_industry_domains) THEN
      _priority := 90;
    ELSIF lower(NEW.name) LIKE '%energy%' OR lower(NEW.domain) LIKE '%energy%' 
      OR lower(NEW.name) LIKE '%renew%' OR lower(NEW.name) LIKE '%ocean%'
      OR lower(NEW.name) LIKE '%wave%' OR lower(NEW.name) LIKE '%tidal%'
      OR lower(NEW.name) LIKE '%marine%' OR lower(NEW.name) LIKE '%hydrogen%' THEN
      _priority := 50;
    ELSE
      _priority := 30;
    END IF;

    INSERT INTO sources (name, rss_url, domain, source_type, country_code, region, language, active, approval_status, health_status, fetch_priority)
    VALUES (
      NEW.name,
      _rss_url,
      NEW.domain,
      COALESCE(NEW.source_type, 'rss'),
      COALESCE(NEW.country_code, 'US'),
      COALESCE(NEW.region, 'global'),
      COALESCE(NEW.language, 'en'),
      true,
      'approved',
      'healthy',
      _priority
    )
    ON CONFLICT (rss_url) DO UPDATE SET
      name = EXCLUDED.name,
      domain = EXCLUDED.domain,
      source_type = EXCLUDED.source_type,
      country_code = EXCLUDED.country_code,
      region = EXCLUDED.region,
      language = EXCLUDED.language,
      active = true,
      approval_status = 'approved',
      fetch_priority = EXCLUDED.fetch_priority;
  END IF;

  IF NEW.approval_status != 'approved' AND (TG_OP = 'UPDATE' AND OLD.approval_status = 'approved') THEN
    UPDATE sources SET active = false WHERE domain = NEW.domain;
  END IF;

  RETURN NEW;
END;
$function$;
