import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const triggeredBy = body.trigger_type || "scheduled";

    const { data: run, error: runErr } = await admin.from("fetch_runs").insert({
      trigger_type: triggeredBy,
      status: "started",
      started_at: new Date().toISOString(),
    }).select("id").single();

    if (runErr) throw runErr;
    const runId = run.id;
    const stats: Record<string, number> = {};

    async function callStage(fnName: string, payload: Record<string, any>, timeoutMs = 120000): Promise<any> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) { const t = await resp.text(); console.log(`${fnName} failed: ${resp.status} ${t.slice(0,200)}`); return null; }
        return await resp.json();
      } catch (e: any) {
        clearTimeout(timer);
        console.log(`${fnName} error: ${e.message}`);
        return null;
      }
    }

    // Step 0: Expand keywords (fast)
    await callStage("expand-keywords", { force: false }, 30000);

    // ══════════════════════════════════════════════════════════
    // PRIORITY 1: Tier 1 Search (Firecrawl site: queries)
    // This is the MOST IMPORTANT stage — finds articles from
    // major publishers even when their RSS feeds don't match.
    // ══════════════════════════════════════════════════════════
    let t1sCount = 0;
    let t1sOff = 0;
    let t1sMore = true;
    while (t1sMore) {
      const r = await callStage("discover-articles", { stage: "tier1_search", offset: t1sOff, limit: 5 }, 90000);
      if (r) { t1sCount += r.discovered || 0; t1sMore = r.hasMore === true; t1sOff += 5; }
      else t1sMore = false;
    }
    stats.tier1_search = t1sCount;

    // PRIORITY 2: Tier 1 RSS/Sitemap scan
    let tier1Count = 0;
    let t1Off = 0;
    let t1More = true;
    while (t1More) {
      const r = await callStage("discover-articles", { stage: "tier1", offset: t1Off, limit: 10, body_scan_budget: 10 }, 90000);
      if (r) { tier1Count += r.discovered || 0; t1More = r.hasMore === true; t1Off += 10; }
      else t1More = false;
    }
    stats.tier1 = tier1Count;

    // PRIORITY 3: Google News
    const gn = await callStage("discover-articles", { stage: "google_news" }, 90000);
    stats.google_news = gn?.discovered || 0;

    // PRIORITY 4: Source feeds (industry-specific RSS)
    let srcCount = 0;
    let srcOff = 0;
    let srcMore = true;
    while (srcMore) {
      const r = await callStage("discover-articles", { stage: "sources", offset: srcOff, limit: 20, body_scan_budget: 8 }, 90000);
      if (r) { srcCount += r.discovered || 0; srcMore = r.hasMore === true; srcOff += 20; }
      else srcMore = false;
    }
    stats.sources = srcCount;

    // PRIORITY 5: Benchmark (reduced — overlaps with tier1 stages)
    let benchmarkCount = 0;
    let benchOffset = 0;
    let benchMore = true;
    while (benchMore) {
      const r = await callStage("benchmark-discover", { offset: benchOffset, limit: 3, body_scan_budget: 15 }, 120000);
      if (r) { benchmarkCount += r.discovered || 0; benchMore = r.hasMore === true; benchOffset += 3; }
      else benchMore = false;
    }
    stats.benchmark = benchmarkCount;

    // PRIORITY 6: Tier 2
    let t2Count = 0;
    let t2Off = 0;
    let t2More = true;
    while (t2More) {
      const r = await callStage("discover-articles", { stage: "tier2", offset: t2Off, limit: 15, body_scan_budget: 6 }, 90000);
      if (r) { t2Count += r.discovered || 0; t2More = r.hasMore === true; t2Off += 15; }
      else t2More = false;
    }
    stats.tier2 = t2Count;

    // PRIORITY 7: Sitemaps
    let smCount = 0;
    let smOff = 0;
    let smMore = true;
    while (smMore) {
      const r = await callStage("discover-sitemaps", { max_domains: 20, deep_scan_limit: 20, offset: smOff }, 90000);
      if (r) { smCount += r.discovered || 0; smMore = (r.domainsScanned || 0) >= 20; smOff += 20; }
      else smMore = false;
    }
    stats.sitemaps = smCount;

    // PRIORITY 8: Firecrawl global search
    const fc = await callStage("firecrawl-search", { max_results: 5, max_queries: 50, enable_scrape: true, enable_ai_classify: true, enable_crawl: true, crawl_domains: 5 }, 150000);
    stats.firecrawl = fc?.discovered || 0;

    // PRIORITY 9: AI discovery
    const ai = await callStage("ai-discover", { max_queries: 8, max_results: 10, relevance_threshold: 0.35 }, 120000);
    stats.ai = ai?.discovered || 0;

    // PRIORITY 10: Story clustering
    const cluster = await callStage("cluster-stories", { max_articles: 200 }, 60000);
    stats.clustered = cluster?.clustered || 0;

    const grandTotal = Object.values(stats).reduce((a, b) => a + b, 0);
    const summary = grandTotal > 0
      ? `${grandTotal} articles (t1search:${stats.tier1_search}, t1rss:${stats.tier1}, gn:${stats.google_news}, src:${stats.sources}, bench:${stats.benchmark}, t2:${stats.tier2}, sm:${stats.sitemaps}, fc:${stats.firecrawl}, ai:${stats.ai})`
      : "No new articles found";

    await admin.from("fetch_runs").update({
      status: "finished",
      finished_at: new Date().toISOString(),
      result_stats: stats,
      summary,
    }).eq("id", runId);

    // Notify users
    const { data: prefs } = await admin.from("notification_preferences").select("user_id").eq("in_app_fetch_complete", true);
    for (const p of (prefs || [])) {
      await admin.from("app_notifications").insert({
        user_id: (p as any).user_id,
        fetch_run_id: runId,
        kind: "fetch_complete",
        title: grandTotal > 0 ? `Discovery: ${grandTotal} articles` : "Discovery complete",
        body: summary,
        payload: stats,
      });
    }

    // Web Push
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({
          title: grandTotal > 0 ? `${grandTotal} articles discovered` : "Fetch complete",
          body: summary,
          data: { runId, total: grandTotal },
        }),
      });
    } catch {}

    // ENRICHMENT: Score newly ingested articles for relevance
    try {
      await fetch(`${supabaseUrl}/functions/v1/enrich-articles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({}),
      });
      console.log("Enrichment triggered");
    } catch (e: any) {
      console.log("Enrichment trigger failed:", e.message);
    }

    // 90-day retention cleanup
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const { data: oldArticles } = await admin.from("articles").select("id").lt("published_at", cutoff.toISOString());
    if (oldArticles && oldArticles.length > 0) {
      const oldIds = oldArticles.map((a: any) => a.id);
      for (let i = 0; i < oldIds.length; i += 100) {
        const chunk = oldIds.slice(i, i + 100);
        await admin.from("article_enrichments").delete().in("article_id", chunk);
        await admin.from("article_bookmarks").delete().in("article_id", chunk);
        await admin.from("article_tags").delete().in("article_id", chunk);
        await admin.from("article_notes").delete().in("article_id", chunk);
        await admin.from("articles").delete().in("id", chunk);
      }
      stats.cleaned = oldArticles.length;
    }

    return new Response(JSON.stringify({ success: true, runId, stats, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
