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

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/[_\-–—]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
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
    const maxQueriesPerKeyword = Math.min(Number(body.max_queries || 3), 5);
    const maxResultsPerQuery = Math.min(Number(body.max_results || 5), 10);

    // Get active keywords
    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (!activeKeywords.length) {
      return new Response(JSON.stringify({ discovered: 0, message: "No active keywords" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Use Lovable AI to generate diverse search queries
    const keywordTexts = activeKeywords.map((k: any) => k.text);
    console.log(`Generating AI search queries for ${keywordTexts.length} keywords`);

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        tools: [{
          type: "function",
          function: {
            name: "generate_queries",
            description: "Generate diverse search queries to find news articles",
            parameters: {
              type: "object",
              properties: {
                queries: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      query: { type: "string", description: "Search query to find relevant articles" },
                      source_keyword: { type: "string", description: "The original keyword this query maps to" },
                    },
                    required: ["query", "source_keyword"],
                  },
                },
              },
              required: ["queries"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "generate_queries" } },
        messages: [
          {
            role: "system",
            content: `You are a news research assistant. Given a list of tracking keywords, generate ${maxQueriesPerKeyword} diverse search queries PER keyword that would find relevant news articles. 

Rules:
- Each query should approach the topic from a DIFFERENT angle (industry news, policy/regulation, technology advances, market analysis, regional developments, company announcements)
- Use specific industry terminology, not generic phrasing
- Include queries that capture related concepts the keyword alone might miss
- Add "news" or "latest" or a recent year to keep results timely
- Map each query back to its source keyword exactly as provided`,
          },
          {
            role: "user",
            content: `Generate search queries for these keywords: ${keywordTexts.join(", ")}`,
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      console.error("AI query generation failed:", aiResponse.status);
      return new Response(JSON.stringify({ discovered: 0, error: "AI query generation failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let queries: { query: string; source_keyword: string }[] = [];
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      queries = parsed.queries || [];
    }
    console.log(`AI generated ${queries.length} search queries`);

    if (!queries.length) {
      return new Response(JSON.stringify({ discovered: 0, queries: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get existing URLs for dedup
    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls || []).map((a: any) => normalizeUrl(a.url)));

    // Get sources for mapping
    const { data: sources } = await supabase.from("sources").select("*").eq("active", true);
    const allSources = sources || [];

    // Build expanded term map for matching
    const expandedTermMap = new Map<string, string>();
    for (const kw of activeKeywords) {
      const expandedTerms = (kw as any).expanded_terms || [];
      for (const et of expandedTerms) {
        expandedTermMap.set(et.toLowerCase(), kw.text);
      }
    }
    const allMatchTerms = [
      ...activeKeywords.map((k: any) => k.text),
      ...Array.from(expandedTermMap.keys()),
    ];

    // Step 2: Execute Firecrawl searches with AI-generated queries
    const discovered: any[] = [];
    let searchesDone = 0;

    for (const q of queries) {
      if (searchesDone >= 15) break; // cap total searches to control credits
      try {
        console.log(`Firecrawl AI query: "${q.query}" (keyword: ${q.source_keyword})`);
        const response = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: q.query,
            limit: maxResultsPerQuery,
            tbs: "qdr:m", // last month
          }),
        });

        searchesDone++;
        if (!response.ok) {
          console.error(`Firecrawl error for "${q.query}": ${response.status}`);
          continue;
        }

        const data = await response.json();
        const results = data.data || [];
        console.log(`  → ${results.length} results`);

        for (const result of results) {
          const url = normalizeUrl(result.url || "");
          if (!url || existingUrlSet.has(url)) continue;

          const searchText = [result.title || "", result.description || ""].join(" ");
          
          // Match against keywords + expanded terms
          const normSearch = normalizeText(searchText);
          const matched = new Set<string>();
          for (const term of allMatchTerms) {
            if (normSearch.includes(normalizeText(term))) {
              const original = expandedTermMap.get(term.toLowerCase()) || term;
              matched.add(original);
            }
          }
          // Always include the source keyword from the AI query
          matched.add(q.source_keyword);

          let domain = "";
          try { domain = normalizeDomain(new URL(url).hostname); } catch {}

          // Try to extract date from URL path
          let publishedAt: string | null = null;
          try {
            const path = new URL(url).pathname;
            const m = path.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//);
            if (m) {
              const d = new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T12:00:00Z`);
              if (!isNaN(d.getTime()) && d.getTime() > new Date("2000-01-01").getTime()) publishedAt = d.toISOString();
            }
          } catch {}

          discovered.push({
            title: (result.title || "").slice(0, 220),
            snippet: (result.description || "").slice(0, 500),
            url,
            published_at: publishedAt || new Date().toISOString(),
            source_domain: domain,
            source_name: domain,
            matched_keywords: Array.from(matched),
          });
          existingUrlSet.add(url);
        }

        // Rate limit between searches
        await new Promise(r => setTimeout(r, 400));
      } catch (e: any) {
        console.error(`Search error for "${q.query}":`, e.message);
      }
    }

    console.log(`AI-discover total unique articles: ${discovered.length}`);

    // Step 3: Sentiment analysis + insert
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
          source_name: a.source_name, source_domain: a.source_domain,
          published_at: a.published_at, fetched_at: new Date().toISOString(),
          matched_keywords: a.matched_keywords,
          language: null, sentiment: "neutral" as string, sentiment_score: 0.5,
        };
      });

      // Batch sentiment
      try {
        const prompt = toInsert.map((it, i) => `[${i}] Title: ${it.title}\nSnippet: ${it.snippet}`).join("\n\n");
        const sr = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            tools: [{ type: "function", function: { name: "classify_sentiments", description: "Classify sentiment", parameters: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "number" }, sentiment: { type: "string", enum: ["positive","neutral","negative"] }, score: { type: "number" } }, required: ["index","sentiment","score"] } } }, required: ["results"] } } }],
            tool_choice: { type: "function", function: { name: "classify_sentiments" } },
            messages: [{ role: "system", content: "Classify the sentiment of each news article." }, { role: "user", content: prompt }],
          }),
        });
        if (sr.ok) {
          const sd = await sr.json();
          const tc = sd.choices?.[0]?.message?.tool_calls?.[0];
          if (tc?.function?.arguments) {
            const p = JSON.parse(tc.function.arguments);
            const res = p.results || [];
            toInsert.forEach((a, i) => {
              const x = res.find((r: any) => r.index === i);
              if (x) { a.sentiment = x.sentiment; a.sentiment_score = x.score; }
            });
          }
        }
      } catch {}

      const { data: ins, error } = await supabase.from("articles")
        .upsert(toInsert, { onConflict: "url", ignoreDuplicates: true }).select("id");
      if (error) console.error("Insert error:", error);
      else totalInserted += ins?.length || 0;
    }

    const summary = { discovered: totalInserted, queries: searchesDone, method: "ai_discover" };
    console.log("AI-discover complete:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ai-discover error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
