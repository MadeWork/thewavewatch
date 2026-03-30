# WaveWatch Setup

## Required Secrets (Edge Functions)

The following secrets must be configured in the backend:

### `PERIGON_API_KEY`
- Sign up at https://www.goperigon.com/
- Developer plan: free, 100 requests/day, no credit card required
- Growth plan: $99/month for 10,000 requests/day — recommended for production
- Used by the `fetch-articles` edge function for tier-1 news aggregation

### `GUARDIAN_API_KEY`
- Completely free, no credit card, instant access
- Register at https://open-platform.theguardian.com/access/
- Free tier: 12 requests/second, 5,000 requests/day — more than enough
- Used by `fetch-articles` for full-text Guardian articles (UK, US, AU editions)

### `SUPABASE_SERVICE_ROLE_KEY`
- Already available in Lovable Cloud backend settings
- Used by edge functions for privileged DB writes (bypasses RLS)

### `SUPABASE_URL`
- Already available in Lovable Cloud backend settings
- Used by edge functions to connect to the database

## Cron Scheduling

The `schedule-ingestion` edge function is triggered hourly by pg_cron.
It calls `fetch-articles` for all active monitored topics.

## Enrichment Pipeline

The `enrich-articles` edge function scores articles for relevance using Lovable AI (Gemini Flash Lite).
It is triggered automatically after each fetch cycle and runs on a 15-minute cron schedule as a safety net.
Cost: negligible — Gemini Flash Lite scoring 20 articles costs fractions of a cent.
