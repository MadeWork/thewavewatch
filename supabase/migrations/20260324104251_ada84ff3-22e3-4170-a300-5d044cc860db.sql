
-- Add fetch_priority column to sources
ALTER TABLE sources ADD COLUMN IF NOT EXISTS fetch_priority integer NOT NULL DEFAULT 30;

-- Populate fetch_priority based on category weighting
-- Press=100, Wire=90, Tech=80, Nordics=70, Europe=60, Energy=50, default=30
UPDATE sources SET fetch_priority = CASE
  WHEN lower(name) LIKE '%press%' OR lower(domain) LIKE '%press%' THEN 100
  WHEN lower(name) LIKE '%wire%' OR lower(domain) LIKE '%wire%' OR lower(name) LIKE '%newswire%' THEN 90
  WHEN lower(name) LIKE '%tech%' OR lower(domain) LIKE '%tech%' OR lower(name) LIKE '%digital%' THEN 80
  WHEN lower(name) LIKE '%nordic%' OR lower(domain) LIKE '%nordic%' OR lower(name) LIKE '%scandi%'
    OR lower(domain) LIKE '%scandi%' OR lower(name) LIKE '%finland%' OR lower(name) LIKE '%sweden%'
    OR lower(name) LIKE '%norway%' OR lower(name) LIKE '%denmark%' OR lower(name) LIKE '%iceland%'
    OR lower(domain) LIKE '%.fi' OR lower(domain) LIKE '%.se' OR lower(domain) LIKE '%.no'
    OR lower(domain) LIKE '%.dk' OR lower(domain) LIKE '%.is' THEN 70
  WHEN lower(name) LIKE '%europe%' OR lower(domain) LIKE '%europe%' OR lower(region) LIKE '%europe%'
    OR lower(name) LIKE '%eu %' OR lower(domain) LIKE '%euronews%' THEN 60
  WHEN lower(name) LIKE '%energy%' OR lower(domain) LIKE '%energy%' OR lower(name) LIKE '%renew%'
    OR lower(domain) LIKE '%renew%' OR lower(name) LIKE '%solar%' OR lower(name) LIKE '%wind%'
    OR lower(name) LIKE '%power%' OR lower(name) LIKE '%grid%' OR lower(name) LIKE '%hydrogen%' THEN 50
  ELSE 30
END;

-- Update the trigger function to also set fetch_priority
CREATE OR REPLACE FUNCTION sync_approved_domain_to_sources()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _priority integer;
BEGIN
  IF NEW.approval_status = 'approved' THEN
    -- Compute fetch_priority based on category weighting
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
      COALESCE(NEW.feed_url, 'https://' || NEW.domain || '/rss'),
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
    ON CONFLICT (domain) DO UPDATE SET
      name = EXCLUDED.name,
      rss_url = EXCLUDED.rss_url,
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
$$;
