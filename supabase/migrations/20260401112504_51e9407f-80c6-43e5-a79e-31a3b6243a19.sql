
-- Enable realtime on articles table
ALTER PUBLICATION supabase_realtime ADD TABLE articles;

-- Enable realtime on ingestion_runs table  
ALTER PUBLICATION supabase_realtime ADD TABLE ingestion_runs;
