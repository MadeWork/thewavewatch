import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

type FetchStage =
  | { step: "discover"; label: "Discovering articles…" }
  | { step: "sitemaps"; label: string }
  | { step: "rss"; label: "Fetching RSS feeds…" }
  | { step: "done"; label: string };

interface FetchState {
  fetching: boolean;
  progress: number; // 0-100
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

    setState({ fetching: true, progress: 5, stage: { step: "discover", label: "Discovering articles…" }, result: null });

    try {
      // Step 1: discover-articles (0-30%)
      const discoverResult = await supabase.functions.invoke("discover-articles", {
        body: { max_domains: 50 },
      });
      if (discoverResult.error) throw discoverResult.error;
      const disc = discoverResult.data;
      const discCount = disc?.discovered ?? 0;
      const totalCandidates = disc?.totalCandidates ?? 0;
      const newDomains = disc?.newDomainsFound ?? 0;

      setState(s => ({ ...s, progress: 30 }));

      // Step 2: discover-sitemaps in batches (30-70%)
      const sitemapBatchSize = 5;
      const sitemapDeepScanLimit = 20;
      let sitemapCount = 0;
      let sitemapDomainsScanned = 0;

      const { count: approvedDomainCount } = await supabase
        .from("approved_domains")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .eq("approval_status", "approved");

      const totalDomains = approvedDomainCount ?? 0;
      const sitemapBatches = Math.max(1, Math.ceil(totalDomains / sitemapBatchSize));

      for (let i = 0; i < sitemapBatches; i++) {
        const batchProgress = 30 + Math.round(((i + 1) / sitemapBatches) * 40);
        setState(s => ({
          ...s,
          progress: batchProgress,
          stage: { step: "sitemaps", label: `Scanning sitemaps… (${i + 1}/${sitemapBatches})` },
        }));

        try {
          const sitemapResult = await supabase.functions.invoke("discover-sitemaps", {
            body: { max_domains: sitemapBatchSize, deep_scan_limit: sitemapDeepScanLimit, offset: i * sitemapBatchSize },
          });
          if (!sitemapResult.error) {
            sitemapCount += sitemapResult.data?.discovered ?? 0;
            sitemapDomainsScanned += sitemapResult.data?.domainsScanned ?? 0;
          }
        } catch {
          // Skip failed batch, continue with next
        }
      }

      // Step 3: fetch-rss (70-95%)
      setState(s => ({ ...s, progress: 75, stage: { step: "rss", label: "Fetching RSS feeds…" } }));

      let rssCount = 0;
      try {
        const rssResult = await supabase.functions.invoke("fetch-rss", { body: { max_sources: 50 } });
        if (!rssResult.error) rssCount = rssResult.data?.totalInserted ?? 0;
      } catch {
        // RSS fetch failed, continue
      }

      // Build result
      const parts: string[] = [];
      if (discCount > 0 || totalCandidates > 0) parts.push(`Discovered ${discCount} articles (${totalCandidates} candidates)`);
      if (sitemapDomainsScanned > 0) parts.push(`${sitemapCount} from sitemaps across ${sitemapDomainsScanned} domains`);
      if (rssCount > 0) parts.push(`${rssCount} from RSS feeds`);
      if (newDomains > 0) parts.push(`${newDomains} new sources found`);

      const resultText = parts.length > 0 ? parts.join(" · ") : "No new articles found matching your keywords";

      queryClient.invalidateQueries({ queryKey: ["articles"] });
      queryClient.invalidateQueries({ queryKey: ["mentions"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-articles"] });
      queryClient.invalidateQueries({ queryKey: ["keywords"] });

      setState({ fetching: false, progress: 100, stage: { step: "done", label: resultText }, result: resultText });

      // Clear progress bar after 4s
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
