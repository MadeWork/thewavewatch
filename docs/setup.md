# WaveWatch Setup

## Required Secrets (Edge Functions)

The following secrets must be configured in the backend:

### `NEWSAPI_KEY`
- Get from https://newsapi.org (free tier: 100 requests/day)
- Used by the `fetch-articles` edge function for NewsAPI queries

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
