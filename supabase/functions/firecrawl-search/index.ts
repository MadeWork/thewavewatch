import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Utilities ────────────────────────────────────────────

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

function parseDateValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractPublishedAtFromHtml(html: string): string | null {
  const metaPatterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+property=["']og:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:published_time["']/i,
    /<meta[^>]+name=["']parsely-pub-date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    const parsed = parseDateValue(match?.[1]);
    if (parsed) return parsed;
  }
  const jsonLdMatches = html.matchAll(/"datePublished"\s*:\s*"([^"]+)"/gi);
  for (const match of jsonLdMatches) {
    const parsed = parseDateValue(match[1]);
    if (parsed) return parsed;
  }
  const timeMatch = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  const timeParsed = parseDateValue(timeMatch?.[1]);
  if (timeParsed) return timeParsed;
  return null;
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

function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
  if (m?.[1]) {
    try { new URL(m[1]); return normalizeUrl(m[1]); } catch {}
  }
  return normalizeUrl(fallbackUrl);
}

function extractLanguageFromHtml(html: string): string | null {
  const m = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  return m ? m[1].split("-")[0].toLowerCase() : null;
}

function extractSourceNameFromHtml(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  return m?.[1] || null;
}

// ── Candidate type ───────────────────────────────────────

interface Candidate {
  title: string;
  snippet: string;
  url: string;
  canonical_url: string;
  published_at: string | null;
  source_domain: string;
  source_name: string;
  matched_keywords: string[];
  matched_via: string; // "title_snippet" | "body_scan" | "ai_classified"
  discovery_method: string;
  body_text?: string;
  language?: string | null;
  relevance_score?: number;
  primary_entity?: string;
  sentiment?: string;
  sentiment_score?: number;
  ai_summary?: string;
}

// ── Firecrawl scrape for metadata extraction ─────────────

async function firecrawlScrape(url: string, firecrawlKey: string): Promise<{
  title?: string; snippet?: string; canonical_url?: string;
  published_at?: string | null; source_name?: string; language?: string | null;
  body_text?: string;
} | null> {
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown", "html"], onlyMainContent: true }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const d = data.data || data;
    const html = d.html || "";
    const markdown = d.markdown || "";
    const meta = d.metadata || {};

    return {
      title: meta.title || d.title || null,
      snippet: (meta.description || "").slice(0, 500),
      canonical_url: meta.sourceURL ? normalizeUrl(meta.sourceURL) : extractCanonicalUrl(html, url),
      published_at: parseDateValue(meta.publishedDate || meta.date) || extractPublishedAtFromHtml(html) || extractDateFromUrl(url),
      source_name: meta.ogSiteName || extractSourceNameFromHtml(html) || null,
      language: meta.language?.split("-")[0]?.toLowerCase() || extractLanguageFromHtml(html) || null,
      body_text: markdown.slice(0, 15000) || extractReadableText(html).slice(0, 15000),
    };
  } catch (e) {
    console.error(`Firecrawl scrape error for ${url}:`, e);
    return null;
  }
}

// ── Fallback HTML fetch (no Firecrawl credits) ───────────

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

// ── AI relevance classification ──────────────────────────

interface RelevanceResult {
  relevant: boolean;
  relevance_score: number;
  primary_entity: string;
  matched_reason: string;
  sentiment: string;
  sentiment_score: number;
  summary: string;
}

async function classifyRelevanceBatch(
  items: { index: number; title: string; snippet: string; body_excerpt: string; search_keyword: string }[],
  apiKey: string,
  companyContext: string
): Promise<Map<number, RelevanceResult>> {
  if (!items.length) return new Map();
  const prompt = items.map(it =>
    `[${it.index}] Keyword: "${it.search_keyword}"\nTitle: ${it.title}\nSnippet: ${it.snippet}\nBody excerpt: ${it.body_excerpt.slice(0, 800)}`
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
            description: "Classify relevance and sentiment of candidate articles",
            parameters: {
              type: "object",
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "number" },
                      relevant: { type: "boolean", description: "Is the tracked entity/topic CENTRAL to the article (not just mentioned in passing)?" },
                      relevance_score: { type: "number", description: "0.0-1.0 relevance score" },
                      primary_entity: { type: "string", description: "The main entity/company/topic the article is about" },
                      matched_reason: { type: "string", description: "Brief reason why this is or isn't relevant" },
                      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
                      sentiment_score: { type: "number", description: "0.0-1.0 sentiment score" },
                      summary: { type: "string", description: "One-sentence summary" },
                    },
                    required: ["index", "relevant", "relevance_score", "primary_entity", "matched_reason", "sentiment", "sentiment_score", "summary"],
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
            content: `You are a media monitoring analyst. Classify whether each article is genuinely relevant to the tracked keywords/entities. ${companyContext ? `Context: we are monitoring for "${companyContext}".` : ""}

Rules:
- "relevant" = the tracked entity/keyword is CENTRAL to the article, not just passing mention
- relevance_score: 0.9+ = about the entity; 0.6-0.9 = significantly related; 0.3-0.6 = tangentially related; <0.3 = not relevant
- Assign sentiment about the tracked entity specifically, not overall article tone
- Summary should capture the key news in one sentence`,
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
      const map = new Map<number, RelevanceResult>();
      for (const item of (p.results || [])) {
        map.set(item.index, item);
      }
      return map;
    }
  } catch (e) {
    console.error("AI classification error:", e);
  }
  return new Map();
}

// ── Simple sentiment batch (for high-confidence matches) ─

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
    const maxResults = Math.min(Number(body.max_results || 5), 10);
    const minThreshold = Number(body.min_threshold ?? 5);
    const priorCounts: Record<string, number> = body.prior_counts || {};
    const relevanceThreshold = Number(body.relevance_threshold ?? 0.4);
    const enableScrape = body.enable_scrape !== false; // default true
    const enableAiClassify = body.enable_ai_classify !== false; // default true

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

    // Filter to keywords needing more results
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

    // Get sources + approved domains for priority matching
    const [{ data: sources }, { data: approvedDomains }] = await Promise.all([
      supabase.from("sources").select("*").eq("active", true),
      supabase.from("approved_domains").select("domain, priority").eq("active", true),
    ]);
    const allSources = sources || [];
    const approvedDomainSet = new Set((approvedDomains || []).map((d: any) => normalizeDomain(d.domain)));

    // Build expanded term map
    const expandedTermMap = new Map<string, string>();
    for (const kw of activeKeywords) {
      for (const et of ((kw as any).expanded_terms || [])) {
        expandedTermMap.set(et.toLowerCase(), kw.text);
      }
    }

    // Search terms: original keywords + top expanded terms
    const searchTerms = [...new Set([
      ...needsSearch.map((k: any) => k.text),
      ...needsSearch.flatMap((k: any) => ((k as any).expanded_terms || []).slice(0, 3)),
    ])];
    const allMatchTerms = [
      ...activeKeywords.map((k: any) => k.text),
      ...Array.from(expandedTermMap.keys()),
    ];

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

    // ── Stage 1: Cheap discovery via Firecrawl search ────
    console.log(`Stage 1: Firecrawl search for ${searchTerms.length} terms`);
    const rawCandidates: Candidate[] = [];

    for (const term of searchTerms) {
      try {
        console.log(`Firecrawl searching: "${term}"`);
        const response = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: `${term} news`, limit: maxResults, tbs: "qdr:w" }),
        });

        if (!response.ok) {
          console.error(`Firecrawl search error for "${term}": ${response.status}`);
          continue;
        }

        const data = await response.json();
        const results = data.data || [];
        console.log(`Firecrawl "${term}": ${results.length} results`);

        for (const result of results) {
          const url = normalizeUrl(result.url || "");
          if (!url || existingUrlSet.has(url)) continue;

          const searchText = [result.title || "", result.description || ""].join(" ");
          const matched = matchKeywordsExpanded(searchText);

          let domain = "";
          try { domain = normalizeDomain(new URL(url).hostname); } catch {}

          const urlDate = extractDateFromUrl(url);
          const metaDate = parseDateValue(result.publishedDate || result.metadata?.publishedDate);

          rawCandidates.push({
            title: (result.title || "").slice(0, 220),
            snippet: (result.description || "").slice(0, 500),
            url,
            canonical_url: url,
            published_at: urlDate || metaDate || null,
            source_domain: domain,
            source_name: domain,
            matched_keywords: matched.length > 0 ? matched : [expandedTermMap.get(term.toLowerCase()) || term],
            matched_via: matched.length > 0 ? "title_snippet" : "search_query",
            discovery_method: "firecrawl_search",
          });
          existingUrlSet.add(url);
        }
        await new Promise(r => setTimeout(r, 400));
      } catch (e: any) {
        console.error(`Firecrawl error for "${term}":`, e.message);
      }
    }

    console.log(`Stage 1 complete: ${rawCandidates.length} raw candidates`);

    // ── Stage 2: Cheap filtering — deterministic match split ─
    const strongMatches: Candidate[] = [];
    const weakCandidates: Candidate[] = [];

    for (const c of rawCandidates) {
      if (c.matched_via === "title_snippet" && c.matched_keywords.length > 0) {
        // Check if it's from an approved/known domain (bonus confidence)
        const isKnownDomain = approvedDomainSet.has(normalizeDomain(c.source_domain));
        if (isKnownDomain || c.matched_keywords.length >= 2) {
          strongMatches.push(c);
        } else {
          // Single keyword match from unknown domain — still decent but verify
          strongMatches.push(c);
        }
      } else {
        weakCandidates.push(c);
      }
    }

    console.log(`Stage 2: ${strongMatches.length} strong matches, ${weakCandidates.length} weak candidates for enrichment`);

    // ── Stage 3: Firecrawl scrape for weak candidates (body scan) ─
    if (enableScrape && weakCandidates.length > 0) {
      const scrapeLimit = Math.min(weakCandidates.length, 10); // cap scrape credits
      console.log(`Stage 3: Scraping ${scrapeLimit} weak candidates for body scan`);

      for (let i = 0; i < scrapeLimit; i += 3) {
        const batch = weakCandidates.slice(i, i + 3);
        await Promise.allSettled(batch.map(async (c) => {
          // Try free HTML fetch first, Firecrawl scrape as fallback
          let meta = await fetchArticleMeta(c.url);
          if (!meta && firecrawlKey) {
            const scraped = await firecrawlScrape(c.url, firecrawlKey);
            if (scraped) {
              meta = {
                published_at: scraped.published_at || null,
                language: scraped.language || null,
                body_text: scraped.body_text || "",
                canonical_url: scraped.canonical_url || c.url,
                source_name: scraped.source_name || null,
              };
            }
          }
          if (!meta) return;

          // Update candidate with enriched data
          c.canonical_url = meta.canonical_url || c.canonical_url;
          c.published_at = c.published_at || meta.published_at;
          c.language = meta.language;
          c.source_name = meta.source_name || c.source_name;
          c.body_text = meta.body_text;

          // Retry keyword matching on body text
          if (meta.body_text) {
            const bodyMatched = matchKeywordsExpanded(meta.body_text);
            if (bodyMatched.length > 0) {
              c.matched_keywords = [...new Set([...c.matched_keywords, ...bodyMatched])];
              c.matched_via = "body_scan";
              strongMatches.push(c);
            }
          }
        }));
      }

      // Remove body-scanned candidates from weak list
      const strongUrls = new Set(strongMatches.map(c => c.canonical_url));
      const stillWeak = weakCandidates.filter(c => !strongUrls.has(c.canonical_url));
      weakCandidates.length = 0;
      weakCandidates.push(...stillWeak);
    }

    console.log(`After body scan: ${strongMatches.length} strong, ${weakCandidates.length} still weak`);

    // ── Stage 4: AI relevance classification for remaining weak candidates ─
    if (enableAiClassify && weakCandidates.length > 0) {
      const classifyLimit = Math.min(weakCandidates.length, 15);
      console.log(`Stage 4: AI classifying ${classifyLimit} weak candidates`);

      const classifyItems = weakCandidates.slice(0, classifyLimit).map((c, i) => ({
        index: i,
        title: c.title,
        snippet: c.snippet,
        body_excerpt: c.body_text || "",
        search_keyword: c.matched_keywords[0] || "",
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
          c.matched_keywords = [...new Set([...c.matched_keywords])];
          strongMatches.push(c);
        }
      }
    }

    console.log(`Final candidates to insert: ${strongMatches.length}`);

    // ── Stage 5: Resolve dates + canonical URLs for strong matches ─
    const needMeta = strongMatches.filter(c => !c.published_at);
    if (needMeta.length > 0) {
      console.log(`Resolving dates for ${needMeta.length} articles`);
      for (let i = 0; i < needMeta.length; i += 3) {
        const batch = needMeta.slice(i, i + 3);
        await Promise.allSettled(batch.map(async (c) => {
          const meta = await fetchArticleMeta(c.url);
          if (meta) {
            c.published_at = c.published_at || meta.published_at;
            c.canonical_url = meta.canonical_url || c.canonical_url;
            c.source_name = meta.source_name || c.source_name;
            c.language = c.language || meta.language;
          }
        }));
      }
    }
    strongMatches.forEach(c => { if (!c.published_at) c.published_at = new Date().toISOString(); });

    // Dedup by canonical URL
    const seenCanonical = new Set<string>();
    const deduped = strongMatches.filter(c => {
      const key = c.canonical_url || c.url;
      if (seenCanonical.has(key) || existingUrlSet.has(key)) return false;
      seenCanonical.add(key);
      return true;
    });

    // ── Stage 6: Insert with sentiment ───────────────────
    let totalInserted = 0;
    for (let b = 0; b < deduped.length; b += 10) {
      const batch = deduped.slice(b, b + 10);

      // For candidates without AI-assigned sentiment, run cheap sentiment
      const needSentiment = batch.filter(c => !c.sentiment);
      if (needSentiment.length > 0) {
        const sentiments = await sentimentBatch(
          needSentiment.map(c => ({ title: c.title, snippet: c.snippet })), lovableApiKey
        );
        needSentiment.forEach((c, i) => { c.sentiment = sentiments[i].sentiment; c.sentiment_score = sentiments[i].score; });
      }

      const toInsert = batch.map(c => {
        const matchedSource = allSources.find((s: any) =>
          normalizeDomain(s.domain || "") === normalizeDomain(c.source_domain)
        );
        return {
          title: c.title,
          snippet: c.snippet,
          url: c.canonical_url || c.url,
          source_id: matchedSource?.id || null,
          source_name: c.source_name || null,
          source_domain: c.source_domain || null,
          published_at: c.published_at,
          fetched_at: new Date().toISOString(),
          matched_keywords: c.matched_keywords,
          language: c.language || null,
          sentiment: c.sentiment || "neutral",
          sentiment_score: c.sentiment_score ?? 0.5,
          discovery_method: c.discovery_method,
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

    // Update keyword match counts
    for (const c of deduped) {
      for (const kw of c.matched_keywords) {
        const k = activeKeywords.find((x: any) => x.text === kw);
        if (k) {
          await supabase.from("keywords").update({ match_count: (k as any).match_count + 1 }).eq("id", (k as any).id);
          (k as any).match_count += 1;
        }
      }
    }

    const summary = {
      discovered: totalInserted,
      searched: searchTerms.length,
      raw_candidates: rawCandidates.length,
      strong_matches: strongMatches.length,
      ai_classified: deduped.filter(c => c.matched_via === "ai_classified").length,
      body_scanned: deduped.filter(c => c.matched_via === "body_scan").length,
      method: "firecrawl_search",
    };
    console.log("Firecrawl search complete:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("firecrawl-search error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
