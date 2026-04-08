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

    setState({ fetching: true, progress: 2, stage: { step: "discover", label: "Expanding keywords…" }, result: null });

    try {
      // Step 0: Expand keywords
      try {
        await withTimeout(supabase.functions.invoke("expand-keywords", { body: { force: false } }), 30000);
      } catch {}

      const counts: Record<string, number> = {};

      // ══════════════════════════════════════════════════════
      // PRIORITY 0: Unified fetch (RSS + Guardian + Perigon + GDELT)
      // This is the same pipeline the scheduled cron uses — most reliable
      // ══════════════════════════════════════════════════════
      setState(s => ({ ...s, progress: 5, stage: { step: "rss", label: "Fetching from all sources (RSS, Guardian, GDELT)…" } }));
      counts.unified = 0;
      try {
        const ufResult = await withTimeout(
          supabase.functions.invoke("fetch-articles", { body: { include_newsapi: true } }),
          120000,
        );
        if (ufResult && !ufResult.error) {
          counts.unified = ufResult.data?.total_inserted || 0;
        }
      } catch {}

      // PRIORITY 1: Tier 1 Search (Firecrawl — only if credits available)
      setState(s => ({ ...s, progress: 30, stage: { step: "discover", label: "Searching major publishers…" } }));
      counts.tier1_search = 0;
      try {
        const data = await invokeStage("tier1_search", { offset: 0, limit: 5 }, 60000);
        if (data) counts.tier1_search += data.discovered || 0;
      } catch {}

      // PRIORITY 2: Tier 1 RSS/Sitemap
      setState(s => ({ ...s, progress: 22, stage: { step: "rss", label: "Scanning publisher feeds…" } }));
      let t1Off = 0;
      let t1More = true;
      let t1Batch = 0;
      counts.tier1_rss = 0;
      while (t1More) {
        const data = await invokeStage("tier1", { offset: t1Off, limit: 10, body_scan_budget: 10 }, 90000);
        if (data) {
          counts.tier1_rss += data.discovered || 0;
          t1More = data.hasMore === true;
          t1Off += 10;
        } else {
          t1More = false;
        }
        t1Batch++;
      }

      // PRIORITY 3: Google News
      setState(s => ({ ...s, progress: 32, stage: { step: "discover", label: "Searching Google News…" } }));
      counts.google_news = 0;
      const gnData = await invokeStage("google_news", {}, 90000);
      if (gnData) counts.google_news = gnData.discovered || 0;

      // PRIORITY 4: Source feeds (industry RSS)
      setState(s => ({ ...s, progress: 40, stage: { step: "rss", label: "Fetching industry feeds…" } }));
      let srcOff = 0;
      let srcMore = true;
      let srcBatch = 0;
      counts.sources = 0;
      while (srcMore) {
        setState(s => ({
          ...s,
          progress: 40 + Math.min(srcBatch * 1.5, 10),
          stage: { step: "rss", label: `Fetching feeds (batch ${srcBatch + 1})…` },
        }));
        const data = await invokeStage("sources", { offset: srcOff, limit: 20, body_scan_budget: 8 }, 90000);
        if (data) {
          counts.sources += data.discovered || 0;
          srcMore = data.hasMore === true;
          srcOff += 20;
        } else {
          srcMore = false;
        }
        srcBatch++;
      }

      // PRIORITY 5: Benchmark sources
      setState(s => ({ ...s, progress: 52, stage: { step: "discover", label: "Benchmark source discovery…" } }));
      let benchOff = 0;
      let benchMore = true;
      let benchBatch = 0;
      counts.benchmark = 0;
      while (benchMore) {
        setState(s => ({
          ...s,
          progress: 52 + Math.min(benchBatch * 1.5, 8),
          stage: { step: "discover", label: `Benchmark sources (batch ${benchBatch + 1})…` },
        }));
        try {
          const result = await withTimeout(
            supabase.functions.invoke("benchmark-discover", {
              body: { offset: benchOff, limit: 2, body_scan_budget: 15 },
            }),
            120000,
          );
          if (result && !result.error) {
            counts.benchmark += result.data?.discovered || 0;
            benchMore = result.data?.hasMore === true;
            benchOff += 2;
          } else {
            benchMore = false;
          }
        } catch {
          benchMore = false;
        }
        benchBatch++;
      }

      // PRIORITY 6: Tier 2
      setState(s => ({ ...s, progress: 62, stage: { step: "discover", label: "Scanning Tier 2 domains…" } }));
      let t2Off = 0;
      let t2More = true;
      let t2Batch = 0;
      counts.tier2 = 0;
      while (t2More) {
        const data = await invokeStage("tier2", { offset: t2Off, limit: 15, body_scan_budget: 6 }, 90000);
        if (data) {
          counts.tier2 += data.discovered || 0;
          t2More = data.hasMore === true;
          t2Off += 15;
        } else {
          t2More = false;
        }
        t2Batch++;
      }

      // PRIORITY 7: Sitemaps
      setState(s => ({ ...s, progress: 70, stage: { step: "sitemaps", label: "Scanning sitemaps…" } }));
      let smOff = 0;
      let smMore = true;
      let smBatch = 0;
      counts.sitemaps = 0;
      while (smMore) {
        try {
          const result = await withTimeout(
            supabase.functions.invoke("discover-sitemaps", {
              body: { max_domains: 20, deep_scan_limit: 20, offset: smOff },
            }),
            90000,
          );
          if (result && !result.error) {
            counts.sitemaps += result.data?.discovered ?? 0;
            smMore = (result.data?.domainsScanned ?? 0) >= 20;
            smOff += 20;
          } else {
            smMore = false;
          }
        } catch {
          smMore = false;
        }
        smBatch++;
      }

      // PRIORITY 8: Firecrawl global search
      setState(s => ({ ...s, progress: 78, stage: { step: "firecrawl", label: "Web search…" } }));
      counts.firecrawl = 0;
      try {
        const fcResult = await withTimeout(
          supabase.functions.invoke("firecrawl-search", {
            body: { max_results: 5, max_queries: 50, enable_scrape: true, enable_ai_classify: true },
          }),
          120000,
        );
        if (fcResult && !fcResult.error) counts.firecrawl = fcResult.data?.discovered ?? 0;
      } catch {}

      // PRIORITY 9: AI discovery
      setState(s => ({ ...s, progress: 90, stage: { step: "firecrawl", label: "AI smart discovery…" } }));
      counts.ai = 0;
      try {
        const aiResult = await withTimeout(
          supabase.functions.invoke("ai-discover", {
            body: { max_queries: 4, max_results: 3, relevance_threshold: 0.35 },
          }),
          90000,
        );
        if (aiResult && !aiResult.error) counts.ai = aiResult.data?.discovered ?? 0;
      } catch {}

      // Build result
      const grandTotal = Object.values(counts).reduce((a, b) => a + b, 0);
      const parts: string[] = [];
      if (counts.unified > 0) parts.push(`${counts.unified} unified fetch`);
      if (counts.tier1_search > 0) parts.push(`${counts.tier1_search} publisher search`);
      if (counts.tier1_rss > 0) parts.push(`${counts.tier1_rss} publisher feeds`);
      if (counts.google_news > 0) parts.push(`${counts.google_news} Google News`);
      if (counts.sources > 0) parts.push(`${counts.sources} industry feeds`);
      if (counts.benchmark > 0) parts.push(`${counts.benchmark} benchmark`);
      if (counts.tier2 > 0) parts.push(`${counts.tier2} tier 2`);
      if (counts.sitemaps > 0) parts.push(`${counts.sitemaps} sitemaps`);
      if (counts.firecrawl > 0) parts.push(`${counts.firecrawl} web search`);
      if (counts.ai > 0) parts.push(`${counts.ai} AI`);

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
            title: grandTotal > 0 ? `Discovery: ${grandTotal} articles` : "Discovery complete",
            body: resultText,
            payload: counts,
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
