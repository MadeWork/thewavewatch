import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","ref","fbclid","gclid"].forEach(p => u.searchParams.delete(p));
    u.hash = "";
    if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch { return url; }
}

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

const BLOCKED_DOMAINS = new Set([
  "facebook.com","m.facebook.com","l.facebook.com",
  "twitter.com","x.com","mobile.twitter.com",
  "instagram.com","linkedin.com",
  "youtube.com","m.youtube.com","youtu.be",
  "tiktok.com","reddit.com","old.reddit.com",
  "pinterest.com","tumblr.com","snapchat.com",
  "threads.net","mastodon.social","bsky.app",
]);

function isBlockedUrl(url: string): boolean {
  try {
    const d = normalizeDomain(new URL(url).hostname);
    for (const b of BLOCKED_DOMAINS) if (d === b || d.endsWith("." + b)) return true;
    return /\/posts?\//i.test(url) || /\/video\//i.test(url) || /\/watch\//i.test(url) || /\/status\//i.test(url);
  } catch { return false; }
}

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/[_\-–—]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function parseDateValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractDateFromUrl(url: string): string | null {
  try {
    const m = new URL(url).pathname.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//);
    if (m) {
      const d = new Date(`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}T12:00:00Z`);
      if (!isNaN(d.getTime()) && d.getTime() > new Date("2000-01-01").getTime()) return d.toISOString();
    }
  } catch {}
  return null;
}

// ── Background processing ────────────────────────────────

async function runAiDiscover(params: {
  maxQueries: number; maxResults: number; relevanceThreshold: number;
}) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!firecrawlKey) { console.log("ai-discover: no Firecrawl key"); return; }

  const [{ data: keywords }, { data: settings }] = await Promise.all([
    supabase.from("keywords").select("*").eq("active", true),
    supabase.from("settings").select("company_name").limit(1).maybeSingle(),
  ]);
  const activeKeywords = keywords || [];
  if (!activeKeywords.length) { console.log("ai-discover: no keywords"); return; }

  const companyName = settings?.company_name && settings.company_name !== "My Company" ? settings.company_name : "";

  // Build term map
  const expandedTermMap = new Map<string, string>();
  for (const kw of activeKeywords) {
    for (const et of ((kw as any).expanded_terms || [])) expandedTermMap.set(et.toLowerCase(), kw.text);
  }
  const allTerms = [...activeKeywords.map((k: any) => k.text), ...Array.from(expandedTermMap.keys())];

  function matchKw(text: string): string[] {
    const n = normalizeText(text);
    const matched = new Set<string>();
    for (const term of allTerms) {
      if (n.includes(normalizeText(term))) matched.add(expandedTermMap.get(term.toLowerCase()) || term);
    }
    return Array.from(matched);
  }

  // Generate queries via AI (lightweight)
  const keywordTexts = activeKeywords.map((k: any) => k.text);
  const maxPerKw = Math.min(params.maxQueries, 4);

  let queries: { query: string; source_keyword: string }[] = [];
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        tools: [{
          type: "function",
          function: {
            name: "gen",
            description: "Generate search queries",
            parameters: {
              type: "object",
              properties: { queries: { type: "array", items: { type: "object", properties: { query: { type: "string" }, source_keyword: { type: "string" } }, required: ["query","source_keyword"] } } },
              required: ["queries"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "gen" } },
        messages: [
          { role: "system", content: `Generate ${maxPerKw} diverse web search queries per keyword for media monitoring.${companyName ? ` Company: "${companyName}".` : ""} Add "news" or "2026" for recency. Return source_keyword matching EXACT keyword text provided.` },
          { role: "user", content: `Keywords: ${keywordTexts.join(", ")}` },
        ],
      }),
    });
    if (r.ok) {
      const d = await r.json();
      const tc = d.choices?.[0]?.message?.tool_calls?.[0];
      if (tc?.function?.arguments) {
        const parsed = JSON.parse(tc.function.arguments);
        const lookup = new Map(keywordTexts.map(t => [t.toLowerCase().trim(), t]));
        queries = (parsed.queries || []).map((q: any) => ({
          query: q.query,
          source_keyword: lookup.get(q.source_keyword?.toLowerCase()?.trim()) || keywordTexts[0],
        }));
      }
    }
  } catch (e) { console.error("AI query gen failed:", e); }

  if (!queries.length) { console.log("ai-discover: no queries generated"); return; }
  console.log(`ai-discover: ${queries.length} queries`);

  // Get existing URLs
  const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
  const existingUrlSet = new Set((existingUrls || []).map((a: any) => normalizeUrl(a.url)));

  // Get sources for matching
  const { data: sources } = await supabase.from("sources").select("id, domain").eq("active", true);

  // Execute searches (max 15 to stay within limits)
  const maxSearches = Math.min(queries.length, 15);
  let totalInserted = 0;
  const toInsert: any[] = [];

  for (let i = 0; i < maxSearches; i++) {
    const q = queries[i];
    try {
      const response = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `${q.query} -site:facebook.com -site:twitter.com -site:linkedin.com -site:youtube.com -site:reddit.com`,
          limit: Math.min(params.maxResults, 5),
          tbs: "qdr:m",
        }),
      });

      if (!response.ok) continue;
      const data = await response.json();

      for (const result of (data.data || [])) {
        const url = normalizeUrl(result.url || "");
        if (!url || existingUrlSet.has(url) || isBlockedUrl(url)) continue;

        const text = `${result.title || ""} ${result.description || ""}`;
        const matched = matchKw(text);
        let domain = "";
        try { domain = normalizeDomain(new URL(url).hostname); } catch {}

        const matchedSource = (sources || []).find((s: any) => normalizeDomain(s.domain || "") === domain);

        const pubDate = parseDateValue(result.metadata?.ogArticlePublishedTime || result.metadata?.["article:published_time"] || result.metadata?.publishedTime || result.publishedDate || result.metadata?.publishedDate)
          || extractDateFromUrl(url);
        toInsert.push({
          title: (result.title || "").slice(0, 220),
          snippet: (result.description || "").slice(0, 500),
          url,
          source_id: matchedSource?.id || null,
          source_name: domain,
          source_domain: domain,
          published_at: pubDate || new Date().toISOString(),
          fetched_at: new Date().toISOString(),
          matched_keywords: matched.length > 0 ? matched : [q.source_keyword],
          sentiment: "neutral",
          sentiment_score: 0.5,
          discovery_method: "ai_discover",
          matched_via: matched.length > 0 ? "title_snippet" : "ai_query",
        });
        existingUrlSet.add(url);
      }

      // Small delay between searches
      await new Promise(r => setTimeout(r, 300));
    } catch (e: any) {
      console.error(`Search error: ${e.message}`);
    }
  }

  // Batch insert
  if (toInsert.length > 0) {
    // Quick sentiment pass
    try {
      const sentimentItems = toInsert.slice(0, 20).map(a => ({ title: a.title, snippet: a.snippet }));
      const prompt = sentimentItems.map((it, i) => `[${i}] ${it.title}`).join("\n");
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          tools: [{ type: "function", function: { name: "s", description: "Classify", parameters: { type: "object", properties: { r: { type: "array", items: { type: "object", properties: { i: { type: "number" }, s: { type: "string", enum: ["positive","neutral","negative"] }, c: { type: "number" } }, required: ["i","s","c"] } } }, required: ["r"] } } }],
          tool_choice: { type: "function", function: { name: "s" } },
          messages: [{ role: "system", content: "Classify sentiment." }, { role: "user", content: prompt }],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        const tc = d.choices?.[0]?.message?.tool_calls?.[0];
        if (tc?.function?.arguments) {
          const p = JSON.parse(tc.function.arguments);
          for (const x of (p.r || [])) {
            if (x.i < toInsert.length) {
              toInsert[x.i].sentiment = x.s;
              toInsert[x.i].sentiment_score = x.c;
            }
          }
        }
      }
    } catch {}

    for (let b = 0; b < toInsert.length; b += 20) {
      const batch = toInsert.slice(b, b + 20);
      const { data: ins, error } = await supabase.from("articles")
        .upsert(batch, { onConflict: "url", ignoreDuplicates: true }).select("id");
      if (error) console.error("Insert error:", error);
      else totalInserted += ins?.length || 0;
    }
  }

  console.log(`ai-discover complete: ${totalInserted} inserted from ${toInsert.length} candidates, ${maxSearches} searches`);
}

// ── Handler ──────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const maxQueries = Math.min(Number(body.max_queries || 4), 8);
    const maxResults = Math.min(Number(body.max_results || 5), 8);
    const relevanceThreshold = Number(body.relevance_threshold ?? 0.4);

    // Run in background
    EdgeRuntime.waitUntil(
      runAiDiscover({ maxQueries, maxResults, relevanceThreshold }).catch(e => {
        console.error("ai-discover background error:", e);
      })
    );

    return new Response(
      JSON.stringify({ status: "processing", message: "AI discovery started in background" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ai-discover error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
