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
  "facebook.com", "m.facebook.com", "l.facebook.com",
  "twitter.com", "x.com", "mobile.twitter.com",
  "instagram.com", "linkedin.com",
  "youtube.com", "m.youtube.com", "youtu.be",
  "tiktok.com", "reddit.com", "old.reddit.com",
  "pinterest.com", "tumblr.com", "snapchat.com",
  "threads.net", "mastodon.social", "bsky.app",
  "t.me", "telegram.org", "wa.me", "whatsapp.com",
  "discord.com", "discord.gg",
]);

const BLOCKED_URL_PATTERNS = [
  /\/posts?\//i, /\/video\//i, /\/watch\//i, /\/reel/i, /\/status\//i,
  /\/stories\//i, /\/shorts\//i, /\/live\//i, /\/pin\//i,
];

function isBlockedDomain(domain: string): boolean {
  const d = normalizeDomain(domain);
  for (const blocked of BLOCKED_DOMAINS) {
    if (d === blocked || d.endsWith("." + blocked)) return true;
  }
  return false;
}

function isBlockedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (isBlockedDomain(u.hostname)) return true;
    for (const pattern of BLOCKED_URL_PATTERNS) {
      if (pattern.test(u.pathname)) return true;
    }
    return false;
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
    const path = new URL(url).pathname;
    const m = path.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//);
    if (m) {
      const d = new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T12:00:00Z`);
      if (!isNaN(d.getTime()) && d.getTime() > new Date("2000-01-01").getTime()) return d.toISOString();
    }
  } catch {}
  return null;
}

function extractPublishedAtFromHtml(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    const parsed = parseDateValue(m?.[1]);
    if (parsed) return parsed;
  }
  const jsonLd = html.matchAll(/"datePublished"\s*:\s*"([^"]+)"/gi);
  for (const m of jsonLd) { const p = parseDateValue(m[1]); if (p) return p; }
  const time = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  return parseDateValue(time?.[1]) || null;
}

function extractCanonicalUrl(html: string, fallback: string): string {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
  if (m?.[1]) { try { new URL(m[1]); return normalizeUrl(m[1]); } catch {} }
  return normalizeUrl(fallback);
}

function extractLanguageFromHtml(html: string): string | null {
  const m = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  return m ? m[1].split("-")[0].toLowerCase() : null;
}

function extractSourceNameFromHtml(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  return m?.[1] || null;
}

function extractReadableText(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (bodyMatch ? bodyMatch[1] : html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchArticleMeta(url: string): Promise<{
  published_at: string | null; language: string | null; body_text: string;
  canonical_url: string; source_name: string | null;
} | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; WaveWatch/1.0)" } });
      if (!resp.ok) return null;
      const html = await resp.text();
      return {
        published_at: extractPublishedAtFromHtml(html) || extractDateFromUrl(url),
        language: extractLanguageFromHtml(html),
        body_text: extractReadableText(html).slice(0, 15000),
        canonical_url: extractCanonicalUrl(html, url),
        source_name: extractSourceNameFromHtml(html),
      };
    } finally { clearTimeout(timeout); }
  } catch { return null; }
}

// ── AI query generation ──────────────────────────────────

interface SearchQuery {
  query: string;
  source_keyword: string;
  angle: string;
}

async function generateSmartQueries(
  keywordTexts: string[],
  companyName: string,
  maxPerKeyword: number,
  apiKey: string
): Promise<SearchQuery[]> {
  const context = companyName ? `The company being monitored is "${companyName}".` : "";
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      tools: [{
        type: "function",
        function: {
          name: "generate_queries",
          description: "Generate diverse search queries for media monitoring",
          parameters: {
            type: "object",
            properties: {
              queries: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                    source_keyword: { type: "string" },
                    angle: { type: "string", enum: ["news", "policy", "technology", "market", "competitors", "executives", "regional", "product"] },
                  },
                  required: ["query", "source_keyword", "angle"],
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
          content: `You are a media monitoring query strategist. Generate ${maxPerKeyword} diverse search queries PER keyword that find relevant news. ${context}

Query strategies:
- "news": breaking news and announcements
- "policy": regulation, government, policy changes
- "technology": technical advances, R&D, patents
- "market": market analysis, investment, funding
- "competitors": competitor mentions, industry comparisons
- "executives": leadership, personnel, quotes
- "regional": geographic-specific news
- "product": product launches, updates, reviews

Rules:
- Each query should use a DIFFERENT angle per keyword
- Use specific industry terminology
- Add "news" or "latest" or "2026" to keep results timely
- For company names, include variations (acronyms, common abbreviations)
- Map each query back to its source keyword EXACTLY as provided`,
        },
        { role: "user", content: `Generate queries for: ${keywordTexts.join(", ")}` },
      ],
    }),
  });

  if (!r.ok) {
    console.error("AI query generation failed:", r.status);
    return [];
  }

  const d = await r.json();
  const tc = d.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc?.function?.arguments) return [];

  const parsed = JSON.parse(tc.function.arguments);
  const queries: SearchQuery[] = parsed.queries || [];

  // Normalize source_keyword to match exact DB keyword text
  const lookup = new Map(keywordTexts.map(t => [t.toLowerCase().trim(), t]));
  return queries.map(q => ({
    ...q,
    source_keyword: lookup.get(q.source_keyword.toLowerCase().trim()) || keywordTexts[0],
  }));
}

// ── AI relevance classification ──────────────────────────

async function classifyRelevanceBatch(
  items: { index: number; title: string; snippet: string; body_excerpt: string; keyword: string }[],
  apiKey: string,
  companyContext: string
): Promise<Map<number, { relevant: boolean; relevance_score: number; primary_entity: string; sentiment: string; sentiment_score: number; summary: string }>> {
  if (!items.length) return new Map();
  const prompt = items.map(it =>
    `[${it.index}] Keyword: "${it.keyword}"\nTitle: ${it.title}\nSnippet: ${it.snippet}\nBody: ${it.body_excerpt.slice(0, 600)}`
  ).join("\n\n");

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        tools: [{
          type: "function",
          function: {
            name: "classify_articles",
            description: "Classify relevance and sentiment",
            parameters: {
              type: "object",
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "number" },
                      relevant: { type: "boolean" },
                      relevance_score: { type: "number" },
                      primary_entity: { type: "string" },
                      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
                      sentiment_score: { type: "number" },
                      summary: { type: "string" },
                    },
                    required: ["index", "relevant", "relevance_score", "primary_entity", "sentiment", "sentiment_score", "summary"],
                  },
                },
              },
              required: ["results"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "classify_articles" } },
        messages: [
          {
            role: "system",
            content: `You are a media monitoring analyst. Classify article relevance. ${companyContext ? `Monitoring: "${companyContext}".` : ""}
- relevant = tracked entity is CENTRAL to the article
- relevance_score: 0.9+ = about entity; 0.6-0.9 = significantly related; <0.4 = not relevant
- Assign sentiment about the tracked entity specifically`,
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!r.ok) return new Map();
    const d = await r.json();
    const tc = d.choices?.[0]?.message?.tool_calls?.[0];
    if (tc?.function?.arguments) {
      const p = JSON.parse(tc.function.arguments);
      const map = new Map<number, any>();
      for (const item of (p.results || [])) map.set(item.index, item);
      return map;
    }
  } catch (e) { console.error("AI classification error:", e); }
  return new Map();
}

// ── Simple sentiment ─────────────────────────────────────

async function sentimentBatch(items: { title: string; snippet: string }[], apiKey: string): Promise<{ sentiment: string; score: number }[]> {
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
        messages: [{ role: "system", content: "Classify sentiment of each news article." }, { role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
    const d = await r.json();
    const tc = d.choices?.[0]?.message?.tool_calls?.[0];
    if (tc?.function?.arguments) {
      const p = JSON.parse(tc.function.arguments);
      const res = p.results || [];
      return items.map((_, i) => { const x = res.find((r: any) => r.index === i); return x ? { sentiment: x.sentiment, score: x.score } : { sentiment: "neutral", score: 0.5 }; });
    }
    return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
  } catch { return items.map(() => ({ sentiment: "neutral", score: 0.5 })); }
}

// ── Main ─────────────────────────────────────────────────

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
    const maxQueriesPerKeyword = Math.min(Number(body.max_queries || 6), 10);
    const maxResultsPerQuery = Math.min(Number(body.max_results || 8), 10);
    const relevanceThreshold = Number(body.relevance_threshold ?? 0.4);

    // Get active keywords & settings
    const [{ data: keywords }, { data: settings }] = await Promise.all([
      supabase.from("keywords").select("*").eq("active", true),
      supabase.from("settings").select("company_name").limit(1).maybeSingle(),
    ]);
    const activeKeywords = keywords || [];
    if (!activeKeywords.length) {
      return new Response(JSON.stringify({ discovered: 0, message: "No active keywords" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyName = settings?.company_name && settings.company_name !== "My Company" ? settings.company_name : "";

    // Build expanded term map
    const expandedTermMap = new Map<string, string>();
    for (const kw of activeKeywords) {
      for (const et of ((kw as any).expanded_terms || [])) {
        expandedTermMap.set(et.toLowerCase(), kw.text);
      }
    }
    const allMatchTerms = [...activeKeywords.map((k: any) => k.text), ...Array.from(expandedTermMap.keys())];

    function matchKeywordsExpanded(text: string): string[] {
      const n = normalizeText(text);
      const matched = new Set<string>();
      for (const term of allMatchTerms) {
        if (n.includes(normalizeText(term))) {
          matched.add(expandedTermMap.get(term.toLowerCase()) || term);
        }
      }
      return Array.from(matched);
    }

    // ── Step 1: Generate smart AI queries ────────────────
    const keywordTexts = activeKeywords.map((k: any) => k.text);
    console.log(`Generating AI queries for ${keywordTexts.length} keywords (${maxQueriesPerKeyword} per keyword)`);

    const queries = await generateSmartQueries(keywordTexts, companyName, maxQueriesPerKeyword, lovableApiKey);
    console.log(`AI generated ${queries.length} search queries`);

    if (!queries.length) {
      return new Response(JSON.stringify({ discovered: 0, queries: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get existing URLs + sources
    const [{ data: existingUrls }, { data: sources }, { data: approvedDomains }] = await Promise.all([
      supabase.from("articles").select("url").limit(5000),
      supabase.from("sources").select("*").eq("active", true),
      supabase.from("approved_domains").select("domain, priority").eq("active", true),
    ]);
    const existingUrlSet = new Set((existingUrls || []).map((a: any) => normalizeUrl(a.url)));
    const allSources = sources || [];
    const approvedDomainSet = new Set((approvedDomains || []).map((d: any) => normalizeDomain(d.domain)));

    // ── Step 2: Execute Firecrawl searches ───────────────
    interface Candidate {
      title: string; snippet: string; url: string; canonical_url: string;
      published_at: string | null; source_domain: string; source_name: string;
      matched_keywords: string[]; matched_via: string; body_text?: string;
      language?: string | null; relevance_score?: number; primary_entity?: string;
      sentiment?: string; sentiment_score?: number; ai_summary?: string;
    }

    const rawCandidates: Candidate[] = [];
    let searchesDone = 0;

    for (const q of queries) {
      if (searchesDone >= 30) break;
      try {
        console.log(`AI query: "${q.query}" [${q.angle}] (kw: ${q.source_keyword})`);
        const response = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: `${q.query} -site:facebook.com -site:twitter.com -site:linkedin.com -site:youtube.com -site:reddit.com -site:instagram.com`, limit: maxResultsPerQuery, tbs: "qdr:m" }),
        });

        searchesDone++;
        if (!response.ok) { console.error(`Firecrawl error: ${response.status}`); continue; }

        const data = await response.json();
        const results = data.data || [];
        console.log(`  → ${results.length} results`);

        for (const result of results) {
          const url = normalizeUrl(result.url || "");
          if (!url || existingUrlSet.has(url) || isBlockedUrl(url)) continue;

          const searchText = [result.title || "", result.description || ""].join(" ");
          const matched = matchKeywordsExpanded(searchText);

          let domain = "";
          try { domain = normalizeDomain(new URL(url).hostname); } catch {}

          rawCandidates.push({
            title: (result.title || "").slice(0, 220),
            snippet: (result.description || "").slice(0, 500),
            url,
            canonical_url: url,
            published_at: extractDateFromUrl(url) || parseDateValue(result.publishedDate) || null,
            source_domain: domain,
            source_name: domain,
            matched_keywords: matched.length > 0 ? matched : [q.source_keyword],
            matched_via: matched.length > 0 ? "title_snippet" : "ai_query",
          });
          existingUrlSet.add(url);
        }
        await new Promise(r => setTimeout(r, 350));
      } catch (e: any) {
        console.error(`Search error for "${q.query}":`, e.message);
      }
    }

    console.log(`Raw candidates: ${rawCandidates.length}`);

    // ── Step 3: Split into strong/weak ───────────────────
    const strongMatches: Candidate[] = [];
    const weakCandidates: Candidate[] = [];

    for (const c of rawCandidates) {
      if (c.matched_via === "title_snippet" && c.matched_keywords.length > 0) {
        strongMatches.push(c);
      } else {
        weakCandidates.push(c);
      }
    }

    // ── Step 4: Body scan weak candidates (free HTML fetch) ─
    if (weakCandidates.length > 0) {
      const scanLimit = Math.min(weakCandidates.length, 12);
      console.log(`Body scanning ${scanLimit} weak candidates`);

      for (let i = 0; i < scanLimit; i += 3) {
        const batch = weakCandidates.slice(i, i + 3);
        await Promise.allSettled(batch.map(async (c) => {
          const meta = await fetchArticleMeta(c.url);
          if (!meta) return;
          c.canonical_url = meta.canonical_url || c.canonical_url;
          c.published_at = c.published_at || meta.published_at;
          c.language = meta.language;
          c.source_name = meta.source_name || c.source_name;
          c.body_text = meta.body_text;

          const bodyMatched = matchKeywordsExpanded(meta.body_text);
          if (bodyMatched.length > 0) {
            c.matched_keywords = [...new Set([...c.matched_keywords, ...bodyMatched])];
            c.matched_via = "body_scan";
            strongMatches.push(c);
          }
        }));
      }

      // Remove promoted from weak
      const strongUrls = new Set(strongMatches.map(c => c.canonical_url));
      const stillWeak = weakCandidates.filter(c => !strongUrls.has(c.canonical_url));
      weakCandidates.length = 0;
      weakCandidates.push(...stillWeak);
    }

    // ── Step 5: AI relevance classification for remaining weak ─
    if (weakCandidates.length > 0) {
      const classifyLimit = Math.min(weakCandidates.length, 15);
      console.log(`AI classifying ${classifyLimit} weak candidates`);

      const classifyItems = weakCandidates.slice(0, classifyLimit).map((c, i) => ({
        index: i, title: c.title, snippet: c.snippet,
        body_excerpt: c.body_text || "", keyword: c.matched_keywords[0] || "",
      }));

      const results = await classifyRelevanceBatch(classifyItems, lovableApiKey, companyName);

      for (let i = 0; i < Math.min(classifyLimit, weakCandidates.length); i++) {
        const r = results.get(i);
        if (!r) continue;
        const c = weakCandidates[i];
        c.relevance_score = r.relevance_score;
        c.primary_entity = r.primary_entity;
        c.sentiment = r.sentiment;
        c.sentiment_score = r.sentiment_score;
        c.ai_summary = r.summary;
        if (r.relevant && r.relevance_score >= relevanceThreshold) {
          c.matched_via = "ai_classified";
          strongMatches.push(c);
        }
      }
    }

    console.log(`Final: ${strongMatches.length} articles to insert`);

    // ── Step 6: Resolve dates ────────────────────────────
    const needDates = strongMatches.filter(c => !c.published_at);
    if (needDates.length > 0) {
      for (let i = 0; i < needDates.length; i += 3) {
        const batch = needDates.slice(i, i + 3);
        await Promise.allSettled(batch.map(async (c) => {
          const meta = await fetchArticleMeta(c.url);
          if (meta) {
            c.published_at = c.published_at || meta.published_at;
            c.canonical_url = meta.canonical_url || c.canonical_url;
            c.source_name = meta.source_name || c.source_name;
          }
        }));
      }
    }
    strongMatches.forEach(c => { if (!c.published_at) c.published_at = new Date().toISOString(); });

    // Dedup by canonical URL
    const seen = new Set<string>();
    const deduped = strongMatches.filter(c => {
      const key = c.canonical_url || c.url;
      if (seen.has(key) || existingUrlSet.has(key)) return false;
      seen.add(key); return true;
    });

    // ── Step 7: Insert ───────────────────────────────────
    let totalInserted = 0;
    for (let b = 0; b < deduped.length; b += 10) {
      const batch = deduped.slice(b, b + 10);

      const needSentiment = batch.filter(c => !c.sentiment);
      if (needSentiment.length > 0) {
        const sentiments = await sentimentBatch(needSentiment.map(c => ({ title: c.title, snippet: c.snippet })), lovableApiKey);
        needSentiment.forEach((c, i) => { c.sentiment = sentiments[i].sentiment; c.sentiment_score = sentiments[i].score; });
      }

      const toInsert = batch.map(c => {
        const matchedSource = allSources.find((s: any) => normalizeDomain(s.domain || "") === normalizeDomain(c.source_domain));
        return {
          title: c.title, snippet: c.snippet, url: c.canonical_url || c.url,
          source_id: matchedSource?.id || null,
          source_name: c.source_name, source_domain: c.source_domain,
          published_at: c.published_at, fetched_at: new Date().toISOString(),
          matched_keywords: c.matched_keywords, language: c.language || null,
          sentiment: c.sentiment || "neutral", sentiment_score: c.sentiment_score ?? 0.5,
          discovery_method: "ai_discover",
          relevance_score: c.relevance_score ?? null,
          primary_entity: c.primary_entity ?? null,
          matched_via: c.matched_via,
          ai_summary: c.ai_summary ?? null,
        };
      });

      const { data: ins, error } = await supabase.from("articles")
        .upsert(toInsert, { onConflict: "url", ignoreDuplicates: true }).select("id");
      if (error) console.error("Insert error:", error);
      else totalInserted += ins?.length || 0;
    }

    const summary = {
      discovered: totalInserted,
      queries: searchesDone,
      raw_candidates: rawCandidates.length,
      ai_classified: deduped.filter(c => c.matched_via === "ai_classified").length,
      body_scanned: deduped.filter(c => c.matched_via === "body_scan").length,
      method: "ai_discover",
    };
    console.log("AI-discover complete:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ai-discover error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
