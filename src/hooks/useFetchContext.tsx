import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

type FetchStage =
  | { step: "discover"; label: string }
  | { step: "sitemaps"; label: string }
  | { step: "rss"; label: string }
  | { step: "firecrawl"; label: string }
  | { step: "done"; label: string };

interface FetchState {
  fetching: boolean;
  progress: number;
  stage: FetchStage | null;
  result: string | null;
}

interface FetchContextValue extends FetchState {
  startFetch: () => void;
}

const FetchContext = createContext<FetchContextValue>({
  fetching: false,
  progress: 0,
  stage: null,
  result: null,
  startFetch: () => {},
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function invokeStage(stage: string, extra: Record<string, any> = {}, timeoutMs = 90000) {
  const result = await withTimeout(
    supabase.functions.invoke("discover-articles", { body: { stage, ...extra } }),
    timeoutMs,
  );
  if (result && !result.error) return result.data;
  return null;
}

export function FetchProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<FetchState>({
    fetching: false,
    progress: 0,
    stage: null,
    result: null,
  });

  const startFetch = useCallback(async () => {
    if (state.fetching) return;

    setState({ fetching: true, progress: 2, stage: { step: "discover", label: "Expanding keywords with AI…" }, result: null });

    try {
      // Step 0: Expand keywords
      try {
        await withTimeout(supabase.functions.invoke("expand-keywords", { body: { force: false } }), 30000);
      } catch {}

      let totalDiscovered = 0;

      // Step 1: Tier 1 domains — no batch limit, iterate until exhausted
      setState(s => ({ ...s, progress: 5, stage: { step: "discover", label: "Scanning major outlets…" } }));
      const TIER1_BATCH = 10;
      let tier1Offset = 0;
      let tier1HasMore = true;
      let tier1BatchNum = 0;
      while (tier1HasMore) {
        setState(s => ({
          ...s,
          progress: 5 + Math.min(tier1BatchNum * 2, 20),
          stage: { step: "discover", label: `Scanning major outlets (batch ${tier1BatchNum + 1})…` },
        }));
        const data = await invokeStage("tier1", { offset: tier1Offset, limit: TIER1_BATCH, body_scan_budget: 15 }, 90000);
        if (data) {
          totalDiscovered += data.discovered || 0;
          tier1HasMore = data.hasMore === true;
          tier1Offset += TIER1_BATCH;
        } else {
          tier1HasMore = false;
        }
        tier1BatchNum++;
      }

      // Step 2: Google News (expanded regions)
      setState(s => ({ ...s, progress: 28, stage: { step: "discover", label: "Searching Google News (global)…" } }));
      const gnData = await invokeStage("google_news", {}, 90000);
      if (gnData) totalDiscovered += gnData.discovered || 0;

      // Step 3: Source feeds — no batch limit, iterate until exhausted
      setState(s => ({ ...s, progress: 38, stage: { step: "rss", label: "Fetching RSS feeds…" } }));
      const SRC_BATCH = 20;
      let srcOffset = 0;
      let srcHasMore = true;
      let srcBatchNum = 0;
      while (srcHasMore) {
        setState(s => ({
          ...s,
          progress: 38 + Math.min(srcBatchNum * 1.5, 12),
          stage: { step: "rss", label: `Fetching RSS feeds (batch ${srcBatchNum + 1})…` },
        }));
        const data = await invokeStage("sources", { offset: srcOffset, limit: SRC_BATCH, body_scan_budget: 10 }, 90000);
        if (data) {
          totalDiscovered += data.discovered || 0;
          srcHasMore = data.hasMore === true;
          srcOffset += SRC_BATCH;
        } else {
          srcHasMore = false;
        }
        srcBatchNum++;
      }

      // Step 4: Tier 2 domains — no batch limit
      setState(s => ({ ...s, progress: 52, stage: { step: "discover", label: "Scanning Tier 2 domains…" } }));
      const T2_BATCH = 15;
      let t2Offset = 0;
      let t2HasMore = true;
      let t2BatchNum = 0;
      while (t2HasMore) {
        setState(s => ({
          ...s,
          progress: 52 + Math.min(t2BatchNum * 1, 8),
          stage: { step: "discover", label: `Scanning Tier 2 domains (batch ${t2BatchNum + 1})…` },
        }));
        const data = await invokeStage("tier2", { offset: t2Offset, limit: T2_BATCH, body_scan_budget: 8 }, 90000);
        if (data) {
          totalDiscovered += data.discovered || 0;
          t2HasMore = data.hasMore === true;
          t2Offset += T2_BATCH;
        } else {
          t2HasMore = false;
        }
        t2BatchNum++;
      }

      // Step 5: Discover sitemaps in batches — no fixed limit
      setState(s => ({ ...s, progress: 62, stage: { step: "sitemaps", label: "Scanning sitemaps…" } }));
      const SITEMAP_BATCH = 20;
      let sitemapOffset = 0;
      let sitemapCount = 0;
      let sitemapBatchNum = 0;
      let sitemapHasMore = true;
      while (sitemapHasMore) {
        setState(s => ({
          ...s,
          progress: 62 + Math.min(sitemapBatchNum * 1, 8),
          stage: { step: "sitemaps", label: `Scanning sitemaps (batch ${sitemapBatchNum + 1})…` },
        }));
        try {
          const sitemapResult = await withTimeout(
            supabase.functions.invoke("discover-sitemaps", {
              body: { max_domains: SITEMAP_BATCH, deep_scan_limit: 20, offset: sitemapOffset },
            }),
            90000,
          );
          if (sitemapResult && !sitemapResult.error) {
            sitemapCount += sitemapResult.data?.discovered ?? 0;
            const domainsScanned = sitemapResult.data?.domainsScanned ?? 0;
            sitemapHasMore = domainsScanned >= SITEMAP_BATCH;
            sitemapOffset += SITEMAP_BATCH;
          } else {
            sitemapHasMore = false;
          }
        } catch {
          sitemapHasMore = false;
        }
        sitemapBatchNum++;
      }

      // Step 6: Firecrawl search (global, all keywords, multi-angle)
      setState(s => ({ ...s, progress: 72, stage: { step: "firecrawl", label: "Firecrawl global search…" } }));
      let firecrawlCount = 0;
      try {
        const fcResult = await withTimeout(
          supabase.functions.invoke("firecrawl-search", {
            body: { max_results: 5, max_queries: 50, enable_scrape: true, enable_ai_classify: true },
          }),
          120000,
        );
        if (fcResult && !fcResult.error) firecrawlCount = fcResult.data?.discovered ?? 0;
      } catch {}

      // Step 7: AI discovery (smart multi-angle queries)
      setState(s => ({ ...s, progress: 88, stage: { step: "firecrawl", label: "AI smart discovery…" } }));
      let aiDiscoverCount = 0;
      try {
        const aiResult = await withTimeout(
          supabase.functions.invoke("ai-discover", {
            body: { max_queries: 8, max_results: 10, relevance_threshold: 0.35 },
          }),
          120000,
        );
        if (aiResult && !aiResult.error) aiDiscoverCount = aiResult.data?.discovered ?? 0;
      } catch {}

      // Build result
      const parts: string[] = [];
      if (totalDiscovered > 0) parts.push(`${totalDiscovered} articles discovered`);
      if (sitemapCount > 0) parts.push(`${sitemapCount} from sitemaps`);
      if (firecrawlCount > 0) parts.push(`${firecrawlCount} from web search`);
      if (aiDiscoverCount > 0) parts.push(`${aiDiscoverCount} from AI discovery`);

      const resultText = parts.length > 0 ? parts.join(" · ") : "No new articles found";

      queryClient.invalidateQueries({ queryKey: ["articles"] });
      queryClient.invalidateQueries({ queryKey: ["mentions"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-articles"] });
      queryClient.invalidateQueries({ queryKey: ["keywords"] });

      setState({ fetching: false, progress: 100, stage: { step: "done", label: resultText }, result: resultText });
      setTimeout(() => setState(s => ({ ...s, progress: 0, stage: null })), 5000);
    } catch (e: any) {
      const msg = `Error: ${e.message}`;
      setState({ fetching: false, progress: 0, stage: null, result: msg });
    }
  }, [state.fetching, queryClient]);

  return (
    <FetchContext.Provider value={{ ...state, startFetch }}>
      {children}
    </FetchContext.Provider>
  );
}

export function useFetch() {
  return useContext(FetchContext);
}
