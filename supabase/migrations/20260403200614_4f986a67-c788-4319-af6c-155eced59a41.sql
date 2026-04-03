
-- Drop the unique constraint on domain
ALTER TABLE public.sources DROP CONSTRAINT sources_domain_unique;

-- Update the sync trigger to use rss_url for conflict detection
CREATE OR REPLACE FUNCTION public.sync_approved_domain_to_sources()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _priority integer;
  _rss_url text;
BEGIN
  IF NEW.approval_status = 'approved' THEN
    _rss_url := COALESCE(NEW.feed_url, 'https://' || NEW.domain || '/rss');

    _priority := 30;
    IF lower(NEW.name) LIKE '%energy%' OR lower(NEW.domain) LIKE '%energy%' OR lower(NEW.name) LIKE '%renew%'
      OR lower(NEW.domain) LIKE '%renew%' OR lower(NEW.name) LIKE '%solar%' OR lower(NEW.name) LIKE '%wind%'
      OR lower(NEW.name) LIKE '%power%' OR lower(NEW.name) LIKE '%grid%' OR lower(NEW.name) LIKE '%hydrogen%' THEN
      _priority := 50;
    END IF;
    IF lower(NEW.name) LIKE '%europe%' OR lower(NEW.domain) LIKE '%europe%' OR lower(COALESCE(NEW.region,'')) LIKE '%europe%' THEN
      _priority := GREATEST(_priority, 60);
    END IF;
    IF lower(NEW.name) LIKE '%nordic%' OR lower(NEW.domain) LIKE '%nordic%' OR lower(NEW.name) LIKE '%scandi%'
      OR lower(COALESCE(NEW.country_code,'')) IN ('FI','SE','NO','DK','IS') THEN
      _priority := GREATEST(_priority, 70);
    END IF;
    IF lower(NEW.name) LIKE '%tech%' OR lower(NEW.domain) LIKE '%tech%' OR lower(NEW.name) LIKE '%digital%' THEN
      _priority := GREATEST(_priority, 80);
    END IF;
    IF lower(NEW.name) LIKE '%wire%' OR lower(NEW.domain) LIKE '%wire%' OR lower(NEW.name) LIKE '%newswire%' THEN
      _priority := GREATEST(_priority, 90);
    END IF;
    IF lower(NEW.name) LIKE '%press%' OR lower(NEW.domain) LIKE '%press%' THEN
      _priority := GREATEST(_priority, 100);
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
