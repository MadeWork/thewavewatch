-- Add owned content engagement columns
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS impressions integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicks integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares integer DEFAULT 0;

-- Composite index for owned vs earned queries
CREATE INDEX IF NOT EXISTS articles_category_published_idx
  ON public.articles(source_category, published_at DESC);

-- Storage bucket for LinkedIn CSV uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('csv-uploads', 'csv-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for csv-uploads bucket
CREATE POLICY "Users can upload own CSVs"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'csv-uploads' AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can view own CSVs"
ON storage.objects FOR SELECT
USING (bucket_id = 'csv-uploads' AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can delete own CSVs"
ON storage.objects FOR DELETE
USING (bucket_id = 'csv-uploads' AND auth.uid() IS NOT NULL);