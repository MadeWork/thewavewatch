
-- Table: monitored_topics
create table if not exists public.monitored_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  keywords text[] not null,
  sources text[] default array['newsapi', 'gdelt'],
  language text default 'en',
  is_active boolean default true,
  last_fetched_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.monitored_topics enable row level security;
create policy "Users manage own topics" on public.monitored_topics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Extend articles table with new columns for the ingestion pipeline
alter table public.articles add column if not exists topic_id uuid references public.monitored_topics(id) on delete cascade;
alter table public.articles add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.articles add column if not exists external_id text;
alter table public.articles add column if not exists source_url text;
alter table public.articles add column if not exists description text;
alter table public.articles add column if not exists content text;
alter table public.articles add column if not exists image_url text;
alter table public.articles add column if not exists media_type text default 'web';
alter table public.articles add column if not exists country text;
alter table public.articles add column if not exists reach_estimate integer;
alter table public.articles add column if not exists ingestion_source text;
alter table public.articles add column if not exists ingestion_run_id uuid;
alter table public.articles add column if not exists is_enriched boolean default false;
alter table public.articles add column if not exists author text;

-- Indexes for new pipeline queries
create index if not exists articles_topic_published on public.articles(topic_id, published_at desc);
create index if not exists articles_user_published on public.articles(user_id, published_at desc);
create index if not exists articles_not_enriched on public.articles(is_enriched) where is_enriched = false;

-- Unique constraint for deduplication (only for new pipeline articles that have these fields)
create unique index if not exists articles_topic_external_source_unique
  on public.articles(topic_id, external_id, ingestion_source)
  where topic_id is not null and external_id is not null and ingestion_source is not null;

-- Table: ingestion_runs
create table if not exists public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references public.monitored_topics(id) on delete cascade,
  source text not null,
  status text not null default 'running',
  articles_fetched integer default 0,
  articles_inserted integer default 0,
  articles_duplicate integer default 0,
  error_message text,
  started_at timestamptz default now(),
  completed_at timestamptz,
  metadata jsonb
);

alter table public.ingestion_runs enable row level security;
create policy "Users read own runs" on public.ingestion_runs
  for select using (
    topic_id in (select id from public.monitored_topics where user_id = auth.uid())
  );

-- Service role needs insert/update on ingestion_runs (no RLS bypass needed, service role bypasses RLS)
