-- Function: auto-sync approved_domains to sources
CREATE OR REPLACE FUNCTION sync_approved_domain_to_sources()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When a domain becomes approved (or is inserted as approved), upsert into sources
  IF NEW.approval_status = 'approved' THEN
    INSERT INTO sources (name, rss_url, domain, source_type, country_code, region, language, active, approval_status, health_status)
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
      'healthy'
    )
    ON CONFLICT (domain) DO UPDATE SET
      name = EXCLUDED.name,
      rss_url = EXCLUDED.rss_url,
      source_type = EXCLUDED.source_type,
      country_code = EXCLUDED.country_code,
      region = EXCLUDED.region,
      language = EXCLUDED.language,
      active = true,
      approval_status = 'approved';
  END IF;

  -- When a domain is set to non-approved, deactivate the source
  IF NEW.approval_status != 'approved' AND (TG_OP = 'UPDATE' AND OLD.approval_status = 'approved') THEN
    UPDATE sources SET active = false WHERE domain = NEW.domain;
  END IF;

  RETURN NEW;
END;
$$;

-- Add unique constraint on sources.domain for upsert
ALTER TABLE sources ADD CONSTRAINT sources_domain_unique UNIQUE (domain);

-- Trigger on insert or update of approved_domains
CREATE TRIGGER trg_sync_approved_domain_to_sources
  AFTER INSERT OR UPDATE ON approved_domains
  FOR EACH ROW
  EXECUTE FUNCTION sync_approved_domain_to_sources();
