
Plan

1. Review the existing source data constraints before applying anything
- Confirmed `public.sources` already has a unique constraint on `domain`.
- That means all the `UPDATE ... WHERE domain = ...` statements are straightforward data updates.
- One item in your SQL needs adjustment before execution: `Ny Teknik Innovation` cannot be inserted as a second row with `domain = 'nyteknik.se'` because `ON CONFLICT DO NOTHING` will skip it.

2. Apply the provided source data updates as data operations
- Run the supplied `UPDATE public.sources ...` statements to:
  - correct RSS URLs
  - reset `consecutive_failures = 0`
  - set `health_status = 'healthy'`
- Run the supplied `active = false` cleanup for permanently broken / low-value domains.
- Keep this as data-only work; no TypeScript or fetch logic changes.

3. Resolve the Ny Teknik duplicate-domain issue with the smallest safe approach
- Since `sources.domain` is unique, I would not execute the `Ny Teknik Innovation` insert exactly as written.
- Safe options:
  - Preferred minimal option: skip the extra insert and only update the main `nyteknik.se` row to the Energy feed.
  - Alternative if you truly want multiple feeds from the same publisher: follow up with a schema change so `sources` can support more than one row per domain.
- Because your current request is data-only, the plan would keep the schema unchanged and avoid inserting the duplicate-domain row.

4. Validate via the existing admin flow
- After data updates, use the existing Admin Ingestion page’s “Run All Now” flow for validation.
- Focus validation on the corrected outlets in the run log / source health views to confirm they re-enter rotation with healthy status.

Technical details
- This is a data operation, not a schema migration.
- Existing database design relevant here:
  - `sources.domain` is unique
  - `sources.rss_url` is required
  - source health is driven by `consecutive_failures` and `health_status`
- No frontend or edge-function code changes are needed for the updates you listed.
- Your current UI already has the admin trigger in `src/pages/AdminIngestion.tsx`, so validation can happen without adding new code.

Expected outcome
- Nordic, European, financial, and specialist feeds you listed should be retried immediately on the next manual ingestion run.
- Dead/noisy sources stop wasting fetch time.
- The only non-executable part of the SQL as written is the second `nyteknik.se` insert because of the unique-domain constraint.
