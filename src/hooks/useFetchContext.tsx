import { createContext, useContext, useState, useCallback, ReactNode, useRef } from "react";
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
      let benchmarkCount = 0;

      // Step 0.5: Benchmark sources — always run first, never skipped
      setState(s => ({ ...s, progress: 3, stage: { step: "discover", label: "Benchmark source discovery…" } }));
      const BENCH_BATCH = 2;
      let benchOffset = 0;
      let benchHasMore = true;
      let benchBatchNum = 0;
      while (benchHasMore) {
        setState(s => ({
          ...s,
          progress: 3 + Math.min(benchBatchNum * 1.5, 12),
          stage: { step: "discover", label: `Benchmark sources (batch ${benchBatchNum + 1})…` },
        }));
        try {
          const result = await withTimeout(
            supabase.functions.invoke("benchmark-discover", {
              body: { offset: benchOffset, limit: BENCH_BATCH, body_scan_budget: 15 },
            }),
            120000,
          );
          if (result && !result.error) {
            benchmarkCount += result.data?.discovered || 0;
            benchHasMore = result.data?.hasMore === true;
            benchOffset += BENCH_BATCH;
          } else {
            benchHasMore = false;
          }
        } catch {
          benchHasMore = false;
        }
        benchBatchNum++;
      }
      totalDiscovered += benchmarkCount;

      // Step 1: Tier 1 site-specific search (PRIMARY — uses Firecrawl site: queries)
      let tier1SearchCount = 0;
      setState(s => ({ ...s, progress: 15, stage: { step: "discover", label: "Searching major outlets…" } }));
      const T1S_BATCH = 5;
      let t1sOffset = 0;
      let t1sHasMore = true;
      let t1sBatchNum = 0;
      while (t1sHasMore) {
        setState(s => ({
          ...s,
          progress: 15 + Math.min(t1sBatchNum * 3, 12),
          stage: { step: "discover", label: `Searching major outlets (batch ${t1sBatchNum + 1})…` },
        }));
        const data = await invokeStage("tier1_search", { offset: t1sOffset, limit: T1S_BATCH }, 90000);
        if (data) {
          tier1SearchCount += data.discovered || 0;
          totalDiscovered += data.discovered || 0;
          t1sHasMore = data.hasMore === true;
          t1sOffset += T1S_BATCH;
        } else {
          t1sHasMore = false;
        }
        t1sBatchNum++;
      }

      // Step 1b: Tier 1 RSS feeds — supplementary scan
      setState(s => ({ ...s, progress: 28, stage: { step: "discover", label: "Scanning RSS feeds from major outlets…" } }));
      const TIER1_BATCH = 10;
      let tier1Offset = 0;
      let tier1HasMore = true;
      let tier1BatchNum = 0;
      while (tier1HasMore) {
        const data = await invokeStage("tier1", { offset: tier1Offset, limit: TIER1_BATCH, body_scan_budget: 10 }, 90000);
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
      let gnCount = 0;
      setState(s => ({ ...s, progress: 30, stage: { step: "discover", label: "Searching Google News (global)…" } }));
      const gnData = await invokeStage("google_news", {}, 90000);
      if (gnData) { gnCount = gnData.discovered || 0; totalDiscovered += gnCount; }

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
            body: { max_queries: 4, max_results: 3, relevance_threshold: 0.35 },
          }),
          90000,
        );
        if (aiResult && !aiResult.error) aiDiscoverCount = aiResult.data?.discovered ?? 0;
      } catch {}

      // Build result
      const parts: string[] = [];
      if (benchmarkCount > 0) parts.push(`${benchmarkCount} benchmark`);
      if (gnCount > 0) parts.push(`${gnCount} Google News`);
      if (totalDiscovered - benchmarkCount - gnCount > 0) parts.push(`${totalDiscovered - benchmarkCount - gnCount} sources/domains`);
      if (sitemapCount > 0) parts.push(`${sitemapCount} sitemaps`);
      if (firecrawlCount > 0) parts.push(`${firecrawlCount} web search`);
      if (aiDiscoverCount > 0) parts.push(`${aiDiscoverCount} AI discovery`);

      const grandTotal = totalDiscovered + sitemapCount + firecrawlCount + aiDiscoverCount;
      const resultText = grandTotal > 0 ? `${grandTotal} articles · ${parts.join(" · ")}` : "No new articles found";

      queryClient.invalidateQueries({ queryKey: ["articles"] });
      queryClient.invalidateQueries({ queryKey: ["mentions"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-articles"] });
      queryClient.invalidateQueries({ queryKey: ["keywords"] });

      // Insert app notification
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("app_notifications").insert({
            user_id: user.id,
            kind: "fetch_complete",
            title: grandTotal > 0 ? `Discovery complete: ${grandTotal} articles` : "Discovery complete",
            body: resultText,
            payload: { total: grandTotal, benchmark: benchmarkCount, sitemaps: sitemapCount, firecrawl: firecrawlCount, ai: aiDiscoverCount },
          });
        }
      } catch {}

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
