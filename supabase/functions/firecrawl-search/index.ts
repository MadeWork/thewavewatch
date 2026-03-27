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

function extractDateFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const slashMatch = path.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
    const slugMatch = path.match(/(?:-|\/)(\d{4})-(\d{2})-(\d{2})(?:\/|$)/);
    const match = slashMatch || slugMatch;
    if (match) {
      const d = new Date(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}T12:00:00Z`);
      if (!isNaN(d.getTime()) && d.getTime() > new Date("2000-01-01").getTime()) return d.toISOString();
    }
    const compactMatch = path.match(/[/-](\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[/-]|$)/);
    if (compactMatch) {
      const d = new Date(`${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}T12:00:00Z`);
      if (!isNaN(d.getTime()) && d.getTime() > new Date("2000-01-01").getTime() && d.getTime() < Date.now() + 86400000) return d.toISOString();
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
  return parseDateValue(timeMatch?.[1]) || null;
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

async function fetchArticleMeta(url: string, firecrawlKey?: string): Promise<{
  published_at: string | null; language: string | null; body_text: string;
  canonical_url: string; source_name: string | null;
} | null> {
  // Try direct fetch first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; WaveWatch/1.0)" } });
      if (resp.ok) {
        const html = await resp.text();
        const pubDate = extractPublishedAtFromHtml(html) || extractDateFromUrl(url);
        if (pubDate) {
          return {
            published_at: pubDate,
            language: extractLanguageFromHtml(html),
            body_text: extractReadableText(html).slice(0, 15000),
            canonical_url: extractCanonicalUrl(html, url),
            source_name: extractSourceNameFromHtml(html),
          };
        }
      }
    } finally { clearTimeout(timeout); }
  } catch {}
  // Fallback: use Firecrawl scrape to bypass bot blocks
  if (firecrawlKey) {
    try {
      const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["html"], onlyMainContent: false, timeout: 10000 }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const html = data.data?.html || "";
        const meta = data.data?.metadata || {};
        const pubDate = parseDateValue(meta.ogArticlePublishedTime || meta["article:published_time"] || meta.publishedTime)
          || extractPublishedAtFromHtml(html) || extractDateFromUrl(url);
        return {
          published_at: pubDate,
          language: meta.language?.split("-")[0] || extractLanguageFromHtml(html),
          body_text: extractReadableText(html).slice(0, 15000),
          canonical_url: normalizeUrl(meta.ogUrl || meta.canonicalUrl || url),
          source_name: meta.ogSiteName || extractSourceNameFromHtml(html),
        };
      }
    } catch {}
  }
  return null;
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
  matched_via: string;
  discovery_method: string;
  body_text?: string;
  language?: string | null;
  relevance_score?: number;
  primary_entity?: string;
  sentiment?: string;
  sentiment_score?: number;
  ai_summary?: string;
}

// ── AI relevance classification ──────────────────────────

async function classifyRelevanceBatch(
  items: { index: number; title: string; snippet: string; body_excerpt: string; search_keyword: string }[],
  apiKey: string,
  companyContext: string
): Promise<Map<number, { relevant: boolean; relevance_score: number; primary_entity: string; sentiment: string; sentiment_score: number; summary: string }>> {
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
                            relevant: { type: "boolean" },
                            relevance_score: { type: "number" },
                            importance: { type: "string", enum: ["high", "medium", "low"] },
                            confidence: { type: "number" },
                            primary_entity: { type: "string" },
                            matched_reason: { type: "string" },
                            sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
                            sentiment_score: { type: "number" },
                            summary: { type: "string" },
                          },
                          required: ["index", "relevant", "relevance_score", "importance", "confidence", "primary_entity", "matched_reason", "sentiment", "sentiment_score", "summary"],
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
            content: `You are a media monitoring analyst. Classify whether each article is genuinely relevant. ${companyContext ? `Context: monitoring for "${companyContext}".` : ""}
- "relevant" = the tracked entity/keyword is CENTRAL to the article
- relevance_score: 0.9+ = about entity; 0.6-0.9 = significantly related; <0.4 = not relevant`,
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

// ── Simple sentiment batch ───────────────────────────────

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

// ── Multi-angle query generation ─────────────────────────

function generateSearchQueries(
  keywords: { text: string; expanded_terms?: string[] }[],
  companyName: string,
  regions: string[]
): { query: string; keyword: string }[] {
  const queries: { query: string; keyword: string }[] = [];
  const siteSuffix = " -site:facebook.com -site:twitter.com -site:linkedin.com -site:youtube.com -site:reddit.com -site:instagram.com -site:tiktok.com";

  for (const kw of keywords) {
    const term = kw.text;
    // Core query
    queries.push({ query: `"${term}" news${siteSuffix}`, keyword: term });
    // With company context
    if (companyName) {
      queries.push({ query: `"${term}" "${companyName}"${siteSuffix}`, keyword: term });
    }
    // Regional angles
    for (const region of regions) {
      queries.push({ query: `"${term}" ${region} news${siteSuffix}`, keyword: term });
    }
    // Industry context
    queries.push({ query: `"${term}" energy renewable latest${siteSuffix}`, keyword: term });
    queries.push({ query: `"${term}" technology investment 2026${siteSuffix}`, keyword: term });
    // Expanded terms
    for (const et of (kw.expanded_terms || []).slice(0, 2)) {
      queries.push({ query: `"${et}" news${siteSuffix}`, keyword: term });
    }
  }
  return queries;
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
    const maxResultsPerQuery = Math.min(Number(body.max_results || 5), 10);
    const relevanceThreshold = Number(body.relevance_threshold ?? 0.4);
    const enableScrape = body.enable_scrape !== false;
    const enableAiClassify = body.enable_ai_classify !== false;
    const enableCrawl = body.enable_crawl === true;
    const crawlDomainLimit = Math.min(Number(body.crawl_domains || 3), 5);
    const maxQueries = Math.min(Number(body.max_queries || 50), 80);

    // Get ALL active keywords (no min_threshold gating)
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

    // ── Generate multi-angle search queries ────────────────
    const regions = ["Europe", "Nordic", "Asia Pacific", "North America"];
    const searchQueries = generateSearchQueries(
      activeKeywords.map((k: any) => ({ text: k.text, expanded_terms: k.expanded_terms || [] })),
      companyName,
      regions
    ).slice(0, maxQueries);

    console.log(`Firecrawl search: ${searchQueries.length} queries for ${activeKeywords.length} keywords`);

    const rawCandidates: Candidate[] = [];
    let searchesDone = 0;

    for (const sq of searchQueries) {
      try {
        console.log(`Firecrawl searching: "${sq.query.slice(0, 80)}"`);
        const response = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: sq.query, limit: maxResultsPerQuery, tbs: "qdr:w" }),
        });

        searchesDone++;
        if (!response.ok) {
          console.error(`Firecrawl search error: ${response.status}`);
          if (response.status === 402) {
            console.error("Firecrawl credits exhausted");
            break;
          }
          continue;
        }

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
            published_at: parseDateValue(result.metadata?.ogArticlePublishedTime || result.metadata?.["article:published_time"] || result.metadata?.publishedTime || result.publishedDate || result.metadata?.publishedDate) || extractDateFromUrl(url) || null,
            source_domain: domain,
            source_name: domain,
            matched_keywords: matched.length > 0 ? matched : [sq.keyword],
            matched_via: matched.length > 0 ? "title_snippet" : "search_query",
            discovery_method: "firecrawl_search",
          });
          existingUrlSet.add(url);
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (e: any) {
        console.error(`Firecrawl error:`, e.message);
      }
    }

    console.log(`Stage 1 complete: ${rawCandidates.length} raw candidates from ${searchesDone} searches`);

    // ── Stage 2: Split into strong/weak ─────────────────
    const strongMatches: Candidate[] = [];
    const weakCandidates: Candidate[] = [];

    for (const c of rawCandidates) {
      if (c.matched_via === "title_snippet" && c.matched_keywords.length > 0) {
        strongMatches.push(c);
      } else {
        weakCandidates.push(c);
      }
    }

    console.log(`Stage 2: ${strongMatches.length} strong matches, ${weakCandidates.length} weak candidates`);

    // ── Stage 3: Body scan for weak candidates ──────────
    if (enableScrape && weakCandidates.length > 0) {
      const scrapeLimit = Math.min(weakCandidates.length, 20);
      console.log(`Stage 3: Body scanning ${scrapeLimit} weak candidates`);

      for (let i = 0; i < scrapeLimit; i += 3) {
        const batch = weakCandidates.slice(i, i + 3);
        await Promise.allSettled(batch.map(async (c) => {
          const meta = await fetchArticleMeta(c.url);
          if (!meta) return;
          c.canonical_url = meta.canonical_url || c.canonical_url;
          c.published_at = c.published_at || meta.published_at;
          c.language = meta.language;
          c.source_name = meta.source_name || c.source_name;
          c.body_text = meta.body_text;

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

      const strongUrls = new Set(strongMatches.map(c => c.canonical_url));
      const stillWeak = weakCandidates.filter(c => !strongUrls.has(c.canonical_url));
      weakCandidates.length = 0;
      weakCandidates.push(...stillWeak);
    }

    console.log(`After body scan: ${strongMatches.length} strong, ${weakCandidates.length} still weak`);

    // ── Stage 3.5: Firecrawl Crawl/Map for priority domains ──
    if (enableCrawl && firecrawlKey) {
      const priorityDomains = (approvedDomains || [])
        .filter((d: any) => (d.priority || 0) >= 80)
        .sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0))
        .slice(0, crawlDomainLimit);

      if (priorityDomains.length > 0) {
        console.log(`Stage 3.5: Crawling ${priorityDomains.length} priority domains via Firecrawl Map`);
        for (const dom of priorityDomains) {
          const domain = normalizeDomain(dom.domain);
          try {
            // Use Firecrawl Map (fast URL discovery)
            const mapResp = await fetch("https://api.firecrawl.dev/v1/map", {
              method: "POST",
              headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                url: `https://${domain}`,
                search: activeKeywords.slice(0, 3).map((k: any) => k.text).join(" "),
                limit: 50,
                includeSubdomains: false,
              }),
            });
            if (!mapResp.ok) continue;
            const mapData = await mapResp.json();
            const discoveredUrls = (mapData.links || []).filter((u: string) => {
              const nu = normalizeUrl(u);
              return !existingUrlSet.has(nu) && !isBlockedUrl(u);
            }).slice(0, 20);

            console.log(`  ${domain}: ${discoveredUrls.length} new URLs from map`);

            // Scrape discovered URLs for keyword matching
            for (const url of discoveredUrls.slice(0, 10)) {
              try {
                const scrapeResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 8000 }),
                });
                if (!scrapeResp.ok) continue;
                const scrapeData = await scrapeResp.json();
                const md = scrapeData.data?.markdown || "";
                const meta = scrapeData.data?.metadata || {};
                const title = meta.title || meta.ogTitle || "";
                const desc = meta.description || meta.ogDescription || "";
                const fullText = `${title} ${desc} ${md}`;
                const matched = matchKeywordsExpanded(fullText);
                if (matched.length > 0 || md.length > 100) {
                  const nu = normalizeUrl(url);
                  if (!existingUrlSet.has(nu)) {
                    strongMatches.push({
                      title: (title || "").slice(0, 220),
                      snippet: (desc || "").slice(0, 500),
                      url: nu,
                      canonical_url: normalizeUrl(meta.ogUrl || meta.canonicalUrl || url),
                      published_at: parseDateValue(meta.ogArticlePublishedTime || meta["article:published_time"]) || extractDateFromUrl(url) || null,
                      source_domain: domain,
                      source_name: meta.ogSiteName || domain,
                      matched_keywords: matched.length > 0 ? matched : [activeKeywords[0]?.text || ""],
                      matched_via: matched.length > 0 ? "crawl_body" : "crawl_discover",
                      discovery_method: "firecrawl_crawl",
                      body_text: md.slice(0, 8000),
                      language: meta.language?.split("-")[0] || null,
                    });
                    existingUrlSet.add(nu);
                  }
                }
              } catch {}
              await new Promise(r => setTimeout(r, 200));
            }
          } catch (e: any) {
            console.error(`Crawl error for ${domain}:`, e.message);
          }
        }
        console.log(`After crawl: ${strongMatches.length} total strong matches`);
      }
    }

    // ── Stage 4: AI classification for remaining weak ───
    if (enableAiClassify && weakCandidates.length > 0) {
      const classifyLimit = Math.min(weakCandidates.length, 20);
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
        (c as any).importance = r.importance;
        (c as any).confidence = r.confidence;
        (c as any).matched_reason = r.matched_reason;
        if (r.relevant && r.relevance_score >= relevanceThreshold) {
          c.matched_via = "ai_classified";
          strongMatches.push(c);
        }
      }
    }

    console.log(`Final candidates to insert: ${strongMatches.length}`);

    // ── Stage 5: Resolve dates via Firecrawl scrape ────
    const needMeta = strongMatches
      .filter(c => !c.published_at)
      .sort((a, b) => Number(b.source_domain === "reuters.com") - Number(a.source_domain === "reuters.com"));
    if (needMeta.length > 0) {
      console.log(`Resolving dates for ${needMeta.length} articles (using Firecrawl scrape fallback)`);
      for (let i = 0; i < Math.min(needMeta.length, 30); i += 3) {
        const batch = needMeta.slice(i, i + 3);
        await Promise.allSettled(batch.map(async (c) => {
          const meta = await fetchArticleMeta(c.url, firecrawlKey);
          if (meta) {
            c.published_at = c.published_at || meta.published_at;
            c.canonical_url = meta.canonical_url || c.canonical_url;
            c.source_name = meta.source_name || c.source_name;
            c.language = c.language || meta.language;
          }
        }));
      }
    }
    // Don't default to now() - leave null so DB uses fetched_at as a fallback display

    // Dedup
    const seenCanonical = new Set<string>();
    const deduped = strongMatches.filter(c => {
      const key = c.canonical_url || c.url;
      if (seenCanonical.has(key) || existingUrlSet.has(key)) return false;
      seenCanonical.add(key);
      return true;
    });

    // ── Stage 6: Insert ─────────────────────────────────
    let totalInserted = 0;
    for (let b = 0; b < deduped.length; b += 10) {
      const batch = deduped.slice(b, b + 10);

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
          title: c.title, snippet: c.snippet, url: c.canonical_url || c.url,
          source_id: matchedSource?.id || null,
          source_name: c.source_name, source_domain: c.source_domain,
          published_at: c.published_at || new Date().toISOString(), fetched_at: new Date().toISOString(),
          matched_keywords: c.matched_keywords, language: c.language || null,
          sentiment: c.sentiment || "neutral", sentiment_score: c.sentiment_score ?? 0.5,
          discovery_method: c.discovery_method,
          relevance_score: c.relevance_score ?? null,
          importance: (c as any).importance ?? "medium",
          confidence: (c as any).confidence ?? null,
          primary_entity: c.primary_entity ?? null,
          matched_reason: (c as any).matched_reason ?? null,
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
      searched: searchesDone,
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
