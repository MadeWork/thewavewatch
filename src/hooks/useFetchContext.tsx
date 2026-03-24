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
      // Step 0: Auto-expand keywords before fetching (fast, skips already-expanded)
      try {
        await withTimeout(supabase.functions.invoke("expand-keywords", { body: { force: false } }), 30000);
      } catch {}
      setState(s => ({ ...s, progress: 5, stage: { step: "discover", label: "Discovering articles…" } }));
      // Step 1: discover-articles with deep scan enabled (0-40%)
      let discCount = 0;
      let newDomains = 0;
      const discoverResult = await withTimeout(
        supabase.functions.invoke("discover-articles", { body: { deep_scan_limit: 20 } }),
        90000
      );
      if (discoverResult && !discoverResult.error) {
        discCount = discoverResult.data?.discovered ?? 0;
        newDomains = discoverResult.data?.newDomainsFound ?? 0;
      }
      setState(s => ({ ...s, progress: 40 }));

      // Step 2: discover-sitemaps in batches of 20 domains (40-70%)
      let sitemapCount = 0;
      const SITEMAP_BATCH_SIZE = 20;
      const SITEMAP_BATCHES = 5;
      for (let batch = 0; batch < SITEMAP_BATCHES; batch++) {
        setState(s => ({
          ...s,
          progress: 42 + batch * 5,
          stage: { step: "sitemaps", label: `Scanning sitemaps… (${batch + 1}/${SITEMAP_BATCHES})` },
        }));
        try {
          const sitemapResult = await withTimeout(
            supabase.functions.invoke("discover-sitemaps", {
              body: { max_domains: SITEMAP_BATCH_SIZE, deep_scan_limit: 15, offset: batch * SITEMAP_BATCH_SIZE },
            }),
            60000
          );
          if (sitemapResult && !sitemapResult.error) {
            sitemapCount += sitemapResult.data?.discovered ?? 0;
          }
        } catch {
          // batch failed, continue
        }
      }
      setState(s => ({ ...s, progress: 65 }));

      // Step 3: fetch-rss (65-80%)
      setState(s => ({ ...s, progress: 67, stage: { step: "rss", label: "Fetching RSS feeds…" } }));
      let rssCount = 0;
      let rssPendingInBackground = false;
      try {
        // Batch 1: all sources (no artificial cap)
        const rss1 = await withTimeout(
          supabase.functions.invoke("fetch-rss", { body: { max_sources: 500 } }),
          90000
        );
        if (rss1 && !rss1.error) rssCount += rss1.data?.totalInserted ?? 0;
      } catch {}
      setState(s => ({ ...s, progress: 80 }));

      // Step 4: Firecrawl hybrid search — discovery + scrape + AI classification (80-95%)
      setState(s => ({ ...s, progress: 82, stage: { step: "firecrawl", label: "Firecrawl search + AI filtering…" } }));
      let firecrawlCount = 0;
      try {
        const priorCounts: Record<string, number> = {};
        if (discCount + sitemapCount + rssCount > 0) {
          const avg = Math.floor((discCount + sitemapCount + rssCount) / Math.max(1, 1));
          priorCounts["_default"] = avg;
        }
        const fcResult = await withTimeout(
          supabase.functions.invoke("firecrawl-search", { body: { max_results: 5, min_threshold: 3, prior_counts: priorCounts, enable_scrape: true, enable_ai_classify: true } }),
          90000
        );
        if (fcResult && !fcResult.error) firecrawlCount = fcResult.data?.discovered ?? 0;
      } catch {}

      // Step 5: AI-powered smart discovery — multi-angle queries + relevance classification (95-99%)
      setState(s => ({ ...s, progress: 95, stage: { step: "firecrawl", label: "AI smart discovery + classification…" } }));
      let aiDiscoverCount = 0;
      try {
        const aiResult = await withTimeout(
          supabase.functions.invoke("ai-discover", { body: { max_queries: 6, max_results: 8, relevance_threshold: 0.4 } }),
          90000
        );
        if (aiResult && !aiResult.error) aiDiscoverCount = aiResult.data?.discovered ?? 0;
      } catch {}

      // Build result
      const parts: string[] = [];
      if (discCount > 0) parts.push(`${discCount} articles discovered`);
      if (sitemapCount > 0) parts.push(`${sitemapCount} from sitemaps`);
      if (rssCount > 0) parts.push(`${rssCount} from RSS`);
      if (firecrawlCount > 0) parts.push(`${firecrawlCount} from web search`);
      if (aiDiscoverCount > 0) parts.push(`${aiDiscoverCount} from AI discovery`);
      if (newDomains > 0) parts.push(`${newDomains} new sources`);

      const resultText = parts.length > 0 ? parts.join(" · ") : "No new articles found";

      queryClient.invalidateQueries({ queryKey: ["articles"] });
      queryClient.invalidateQueries({ queryKey: ["mentions"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-articles"] });
      queryClient.invalidateQueries({ queryKey: ["keywords"] });

      setState({ fetching: false, progress: 100, stage: { step: "done", label: resultText }, result: resultText });
      setTimeout(() => setState(s => ({ ...s, progress: 0, stage: null })), 4000);
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
