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

/** Wrap a promise with a timeout – resolves to null on timeout instead of throwing */
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

    setState({ fetching: true, progress: 5, stage: { step: "discover", label: "Discovering articles…" }, result: null });

    try {
      // Step 1: discover-articles – 60s timeout (0-40%)
      let discCount = 0;
      let newDomains = 0;
      const discoverResult = await withTimeout(
        supabase.functions.invoke("discover-articles", { body: { max_domains: 20 } }),
        60000
      );
      if (discoverResult && !discoverResult.error) {
        discCount = discoverResult.data?.discovered ?? 0;
        newDomains = discoverResult.data?.newDomainsFound ?? 0;
      }
      setState(s => ({ ...s, progress: 40 }));

      // Step 2: discover-sitemaps – single call with limited scope (40-70%)
      let sitemapCount = 0;
      setState(s => ({
        ...s,
        progress: 45,
        stage: { step: "sitemaps", label: "Scanning sitemaps…" },
      }));
      try {
        const sitemapResult = await withTimeout(
          supabase.functions.invoke("discover-sitemaps", {
            body: { max_domains: 10, deep_scan_limit: 25 },
          }),
          45000
        );
        if (sitemapResult && !sitemapResult.error) {
          sitemapCount = sitemapResult.data?.discovered ?? 0;
        }
      } catch {
        // sitemap scan failed, continue
      }
      setState(s => ({ ...s, progress: 70 }));

      // Step 3: fetch-rss (70-95%)
      setState(s => ({ ...s, progress: 75, stage: { step: "rss", label: "Fetching RSS feeds…" } }));
      let rssCount = 0;
      try {
        const rssResult = await withTimeout(
          supabase.functions.invoke("fetch-rss", { body: { max_sources: 30 } }),
          30000
        );
        if (rssResult && !rssResult.error) rssCount = rssResult.data?.totalInserted ?? 0;
      } catch {
        // RSS fetch failed, continue
      }

      // Build result
      const parts: string[] = [];
      if (discCount > 0) parts.push(`${discCount} articles discovered`);
      if (sitemapCount > 0) parts.push(`${sitemapCount} from sitemaps`);
      if (rssCount > 0) parts.push(`${rssCount} from RSS`);
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
