-- Update existing topics to use new source names
UPDATE public.monitored_topics
  SET sources = array['perigon', 'guardian', 'gdelt']
  WHERE sources = array['newsapi', 'gdelt'] 
     OR sources = array['newsapi']
     OR sources IS NULL;

-- Update column default for new topics
ALTER TABLE public.monitored_topics 
  ALTER COLUMN sources SET DEFAULT array['perigon', 'guardian', 'gdelt'];