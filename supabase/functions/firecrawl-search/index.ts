import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","oc","ref","fbclid","gclid"].forEach(p => u.searchParams.delete(p));
    u.hash = "";
    if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch { return url; }
}

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/[_\-–—]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function matchKeywords(text: string, keywords: string[]): string[] {
  const n = normalizeText(text);
  return keywords.filter(kw => n.includes(normalizeText(kw)));
}

async function analyzeSentimentBatch(items: { title: string; snippet: string }[], apiKey: string): Promise<{ sentiment: string; score: number }[]> {
  if (!items.length) return [];
  const prompt = items.map((it, i) => `[${i}] Title: ${it.title}\nSnippet: ${it.snippet}`).join("\n\n");
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        tools: [{ type: "function", function: { name: "classify_sentiments", description: "Classify sentiment", parameters: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "number" }, sentiment: { type: "string", enum: ["positive","neutral","negative"] }, score: { type: "number" } }, required: ["index","sentiment","score"] } } }, required: ["results"] } } }],
        tool_choice: { type: "function", function: { name: "classify_sentiments" } },
        messages: [{ role: "system", content: "Classify the sentiment of each news article." }, { role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
    const d = JSON.parse(await r.text());
    const tc = d.choices?.[0]?.message?.tool_calls?.[0];
    if (tc?.function?.arguments) {
      const p = JSON.parse(tc.function.arguments);
      const res = p.results || [];
      return items.map((_, i) => { const x = res.find((r: any) => r.index === i); return x ? { sentiment: x.sentiment, score: x.score } : { sentiment: "neutral", score: 0.5 }; });
    }
    return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
  } catch { return items.map(() => ({ sentiment: "neutral", score: 0.5 })); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!firecrawlKey) {
      return new Response(JSON.stringify({ error: "Firecrawl not configured", discovered: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const maxResults = Math.min(Number(body.max_results || 5), 10);
    const minThreshold = Number(body.min_threshold ?? 5);
    const priorCounts: Record<string, number> = body.prior_counts || {};

    // Get active keywords
    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (!activeKeywords.length) {
      return new Response(JSON.stringify({ discovered: 0, message: "No active keywords" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter to only keywords that need more results
    const needsSearch = activeKeywords.filter((k: any) => {
      const prior = priorCounts[k.text] ?? 0;
      return prior < minThreshold;
    });
    console.log(`Keywords needing Firecrawl: ${needsSearch.length}/${activeKeywords.length}`);
    if (!needsSearch.length) {
      return new Response(JSON.stringify({ discovered: 0, searched: 0, skipped: activeKeywords.length, method: "firecrawl_search" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get existing URLs for dedup
    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls || []).map((a: any) => normalizeUrl(a.url)));

    // Get sources for mapping
    const { data: sources } = await supabase.from("sources").select("*").eq("active", true);
    const allSources = sources || [];

    const searchTerms = needsSearch.map((k: any) => k.text);
    const allKeywordTexts = activeKeywords.map((k: any) => k.text);
    const discovered: any[] = [];

    // Search for each keyword using Firecrawl
    for (const term of searchTerms) {
      try {
        console.log(`Firecrawl searching: "${term}"`);
        const response = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `${term} news`,
            limit: maxResults,
            tbs: "qdr:w", // last week
            scrapeOptions: { formats: ["markdown"] },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error(`Firecrawl search error for "${term}": ${response.status} ${errText}`);
          continue;
        }

        const data = await response.json();
        const results = data.data || [];
        console.log(`Firecrawl "${term}": ${results.length} results`);

        for (const result of results) {
          const url = normalizeUrl(result.url || "");
          if (!url || existingUrlSet.has(url)) continue;

          // Match keywords against title + description + markdown body
          const searchText = [result.title || "", result.description || "", (result.markdown || "").slice(0, 5000)].join(" ");
          const matched = matchKeywords(searchText, searchTerms);
          if (matched.length === 0) continue;

          let domain = "";
          try { domain = normalizeDomain(new URL(url).hostname); } catch {}

          discovered.push({
            title: (result.title || "").slice(0, 220),
            snippet: (result.description || (result.markdown || "").slice(0, 300)).slice(0, 500),
            url,
            published_at: new Date().toISOString(),
            source_domain: domain,
            source_name: domain,
            matched_keywords: matched,
          });
          existingUrlSet.add(url); // prevent dupes within this run
        }

        // Rate limit between searches
        await new Promise(r => setTimeout(r, 500));
      } catch (e: any) {
        console.error(`Firecrawl error for "${term}":`, e.message);
      }
    }

    console.log(`Firecrawl total unique articles: ${discovered.length}`);

    // Insert with sentiment
    let totalInserted = 0;
    for (let b = 0; b < discovered.length; b += 10) {
      const batch = discovered.slice(b, b + 10);
      const toInsert = batch.map(a => {
        const matchedSource = allSources.find((s: any) =>
          normalizeDomain(s.domain || "") === normalizeDomain(a.source_domain)
        );
        return {
          title: a.title, snippet: a.snippet, url: a.url,
          source_id: matchedSource?.id || null,
          source_name: a.source_name || null,
          source_domain: a.source_domain || null,
          published_at: a.published_at, fetched_at: new Date().toISOString(),
          matched_keywords: a.matched_keywords,
          language: null,
          sentiment: "neutral" as string, sentiment_score: 0.5,
        };
      });

      const sentiments = await analyzeSentimentBatch(
        toInsert.map(a => ({ title: a.title, snippet: a.snippet || "" })), lovableApiKey
      );
      toInsert.forEach((a, i) => { a.sentiment = sentiments[i].sentiment; a.sentiment_score = sentiments[i].score; });

      const { data: ins, error } = await supabase.from("articles")
        .upsert(toInsert, { onConflict: "url", ignoreDuplicates: true }).select("id");
      if (error) console.error("Insert error:", error);
      else totalInserted += ins?.length || 0;
    }

    // Update keyword match counts
    for (const a of discovered) {
      for (const kw of a.matched_keywords) {
        const k = activeKeywords.find((x: any) => x.text === kw);
        if (k) {
          await supabase.from("keywords").update({ match_count: k.match_count + 1 }).eq("id", k.id);
          k.match_count += 1;
        }
      }
    }

    const summary = { discovered: totalInserted, searched: searchTerms.length, method: "firecrawl_search" };
    console.log("Firecrawl search complete:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("firecrawl-search error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
