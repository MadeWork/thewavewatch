
-- Approved domains registry
CREATE TABLE public.approved_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL UNIQUE,
  country_code text DEFAULT 'US',
  region text DEFAULT 'global',
  language text DEFAULT 'en',
  source_type text DEFAULT 'rss',
  feed_url text,
  sitemap_url text,
  approval_status text NOT NULL DEFAULT 'approved',
  auto_discovered boolean DEFAULT false,
  active boolean DEFAULT true,
  priority integer DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.approved_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read approved_domains" ON public.approved_domains
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated write approved_domains" ON public.approved_domains
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated update approved_domains" ON public.approved_domains
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated delete approved_domains" ON public.approved_domains
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE INDEX idx_approved_domains_domain ON public.approved_domains(domain);
CREATE INDEX idx_approved_domains_region ON public.approved_domains(region);
CREATE INDEX idx_approved_domains_status ON public.approved_domains(approval_status);

-- Add approval_status to sources table
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS language text DEFAULT 'en';
