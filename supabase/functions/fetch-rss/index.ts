import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ParsedArticle { title: string; snippet: string; url: string; published_at: string | null; language?: string | null; }
interface FetchTarget {
  id: string | null;
  name: string;
  domain: string | null;
  rss_url: string;
  source_type: string;
  crawl_delay_ms: number;
  consecutive_failures: number;
  isVirtual: boolean;
}

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal, headers: { "User-Agent": "MediaPulse/1.0 RSS Reader" } }); }
  finally { clearTimeout(timeout); }
}

async function fetchWithRetry(url: string, timeoutMs = 15000, maxRetries = 2, label = ""): Promise<{ response: Response | null; elapsed: number; attempts: number; error?: string }> {
  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    const start = Date.now();
    try {
      const resp = await fetchWithTimeout(url, timeoutMs);
      const elapsed = Date.now() - start;
      if (resp.status >= 500 && attempt < maxRetries) {
        await resp.text().catch(() => {});
        console.log(`[retry] ${label || url.slice(0, 60)}: HTTP ${resp.status}, attempt ${attempt + 1} (${elapsed}ms)`);
        lastError = `HTTP ${resp.status}`;
        continue;
      }
      return { response: resp, elapsed, attempts: attempt + 1 };
    } catch (e: any) {
      const elapsed = Date.now() - start;
      lastError = e.name === "AbortError" ? `timeout (${timeoutMs}ms)` : (e.message || "network error");
      if (attempt < maxRetries) {
        console.log(`[retry] ${label || url.slice(0, 60)}: ${lastError}, attempt ${attempt + 1} (${elapsed}ms)`);
        continue;
      }
      return { response: null, elapsed, attempts: attempt + 1, error: lastError };
    }
  }
  return { response: null, elapsed: 0, attempts: maxRetries + 1, error: lastError };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "oc", "ref", "fbclid", "gclid"].forEach(p => u.searchParams.delete(p));
    u.hash = "";
    if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch { return url; }
}

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

function toAbsoluteUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getSourceDomain(source: { domain?: string | null; rss_url?: string | null }): string {
  if (source.domain) return normalizeDomain(source.domain);
  if (source.rss_url) {
    try {
      return normalizeDomain(new URL(source.rss_url).hostname);
    } catch {}
  }
  return "";
}

function buildVirtualSource(domainRow: any): FetchTarget | null {
  const normalizedDomain = normalizeDomain(domainRow.domain || "");
  if (!normalizedDomain) return null;

  // Only hydrate domains with an explicit feed or sitemap URL
  const hasFeed = domainRow.feed_url && domainRow.feed_url.trim();
  const hasSitemap = domainRow.sitemap_url && domainRow.sitemap_url.trim();
  if (!hasFeed && !hasSitemap) return null;

  const sourceType = hasSitemap || domainRow.source_type === "sitemap" || domainRow.source_type === "news_sitemap"
    ? "sitemap"
    : domainRow.source_type === "atom" ? "atom" : "rss";

  const targetUrl = sourceType === "sitemap"
    ? (toAbsoluteUrl(domainRow.sitemap_url) || `https://${normalizedDomain}/sitemap.xml`)
    : toAbsoluteUrl(domainRow.feed_url);

  if (!targetUrl) return null;

  return {
    id: null,
    name: domainRow.name || normalizedDomain,
    domain: normalizedDomain,
    rss_url: targetUrl,
    source_type: sourceType,
    crawl_delay_ms: 2000,
    consecutive_failures: 0,
    isVirtual: true,
  };
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

function detectLanguage(html: string): string | null {
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  if (langMatch) return langMatch[1].split("-")[0].toLowerCase();
  return null;
}

function extractPublishedAtFromHtml(html: string): string | null {
  const metaPatterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+property=["']og:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:published_time["']/i,
    /<meta[^>]+name=["']parsely-pub-date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']parsely-pub-date["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']datePublished["']/i,
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

  const epochMatch = html.match(/data-published-at=["'](\d{10,13})["']/i);
  if (epochMatch) {
    const raw = epochMatch[1];
    const epochMs = raw.length === 13 ? Number(raw) : Number(raw) * 1000;
    return parseDateValue(new Date(epochMs).toISOString());
  }

  return null;
}

async function fetchArticleMetadata(url: string): Promise<{ published_at: string | null; language: string | null } | null> {
  try {
    const { response: resp } = await fetchWithRetry(url, 25000, 2, `metadata ${url.slice(0, 50)}`);
    if (!resp?.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) { await resp.text(); return null; }
    const html = await resp.text();
    return {
      published_at: extractPublishedAtFromHtml(html) || extractDateFromUrl(url),
      language: detectLanguage(html),
    };
  } catch {
    return null;
  }
}

function parseRSSAtom(xml: string): ParsedArticle[] {
  const items: ParsedArticle[] = [];
  const getTag = (c: string, tag: string) => { const m = c.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "si")); return m ? m[1].trim() : ""; };

  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getTag(c, "title");
    const link = getTag(c, "link") || getTag(c, "guid");
    const desc = getTag(c, "description").replace(/<[^>]+>/g, "").slice(0, 500);
    const pubDate = getTag(c, "pubDate") || getTag(c, "dc:date") || getTag(c, "published");
    if (title && link) items.push({ title, snippet: desc, url: link, published_at: parseDateValue(pubDate) || extractDateFromUrl(link) });
  }
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((m = entryRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getTag(c, "title");
    const linkMatch = c.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : getTag(c, "link");
    const summary = (getTag(c, "summary") || getTag(c, "content")).replace(/<[^>]+>/g, "").slice(0, 500);
    const updated = getTag(c, "updated") || getTag(c, "published");
    if (title && link) items.push({ title, snippet: summary, url: link, published_at: parseDateValue(updated) || extractDateFromUrl(link) });
  }
  return items;
}

function parseSitemap(xml: string): ParsedArticle[] {
  const items: ParsedArticle[] = [];
  const re = /<url>([\s\S]*?)<\/url>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const c = m[1];
    const locM = c.match(/<loc>(.*?)<\/loc>/i);
    const lastmod = c.match(/<lastmod>(.*?)<\/lastmod>/i);
    const newsTitle = c.match(/<news:title>(.*?)<\/news:title>/i);
    const newsPub = c.match(/<news:publication_date>(.*?)<\/news:publication_date>/i);
    if (locM) {
      const url = locM[1].trim();
      items.push({
        title: newsTitle ? newsTitle[1].trim() : url.split("/").filter(Boolean).pop() || url,
        snippet: "", url,
        published_at: parseDateValue((newsPub || lastmod)?.[1]) || extractDateFromUrl(url),
      });
    }
  }
  return items;
}

function parseHTMLArticles(html: string, baseUrl: string): ParsedArticle[] {
  const items: ParsedArticle[] = [];
  const patterns = [/<article[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, /<h[1-3][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi];
  const seen = new Set<string>();
  for (const regex of patterns) {
    let m;
    while ((m = regex.exec(html)) !== null && items.length < 30) {
      const href = m[1]; const text = m[2].replace(/<[^>]+>/g, "").trim();
      if (text.length > 10 && !href.startsWith("#") && !href.startsWith("javascript") && !seen.has(href)) {
        seen.add(href);
        const fullUrl = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
        items.push({ title: text.slice(0, 200), snippet: "", url: fullUrl, published_at: extractDateFromUrl(fullUrl) });
      }
    }
  }
  return items;
}

/** Unicode-safe text normalization */
function normalizeText(t: string): string {
  return t.replace(/<[^>]+>/g, " ").replace(/&[a-z0-9#]+;/gi, " ").toLowerCase().replace(/[_\-–—]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

async function analyzeSentimentBatch(items: { title: string; snippet: string }[], apiKey: string): Promise<{ sentiment: string; score: number }[]> {
  if (!items.length) return [];
  const prompt = items.map((it, i) => `[${i}] Title: ${it.title}\nSnippet: ${it.snippet}`).join("\n\n");
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", tools: [{ type: "function", function: { name: "classify_sentiments", description: "Classify sentiment", parameters: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "number" }, sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }, score: { type: "number" } }, required: ["index", "sentiment", "score"] } } }, required: ["results"] } } }], tool_choice: { type: "function", function: { name: "classify_sentiments" } }, messages: [{ role: "system", content: "Classify the sentiment of each news article." }, { role: "user", content: prompt }] }),
    });
    if (!r.ok) return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
    const d = JSON.parse(await r.text());
    const tc = d.choices?.[0]?.message?.tool_calls?.[0];
    if (tc?.function?.arguments) { const p = JSON.parse(tc.function.arguments); const res = p.results || []; return items.map((_, i) => { const x = res.find((r: any) => r.index === i); return x ? { sentiment: x.sentiment, score: x.score } : { sentiment: "neutral", score: 0.5 }; }); }
    return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
  } catch { return items.map(() => ({ sentiment: "neutral", score: 0.5 })); }
}

const domainLastFetch: Record<string, number> = {};
async function rateLimitedFetch(url: string, crawlDelayMs: number): Promise<Response> {
  return fetchWithTimeout(url, 6000);
}

// ── Paginated fetch ──────────────────────────────────────

async function fetchAllSources(supabase: any): Promise<any[]> {
  const PAGE = 500;
  let all: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from("sources").select("*").eq("active", true).eq("approval_status", "approved").range(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function fetchAllApprovedDomains(supabase: any): Promise<any[]> {
  const PAGE = 500;
  let all: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from("approved_domains")
      .select("*")
      .eq("active", true)
      .eq("approval_status", "approved")
      .range(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const maxSources = Number(body.max_sources || 500);

    // Fetch ALL active sources + hydrate missing approved domains into virtual fetch targets
    const storedSources = await fetchAllSources(supabase);
    const approvedDomains = await fetchAllApprovedDomains(supabase);
    const storedSourceDomains = new Set(storedSources.map((source: any) => getSourceDomain(source)).filter(Boolean));
    const hydratedSources = approvedDomains
      .filter((domainRow: any) => {
        const normalizedDomain = normalizeDomain(domainRow.domain || "");
        return normalizedDomain && !storedSourceDomains.has(normalizedDomain);
      })
      .map(buildVirtualSource)
      .filter((source): source is FetchTarget => Boolean(source));

    const sources: FetchTarget[] = [
      ...storedSources.map((source: any) => ({
        id: source.id ?? null,
        name: source.name,
        domain: source.domain || null,
        rss_url: source.rss_url,
        source_type: source.source_type || "rss",
        crawl_delay_ms: source.crawl_delay_ms || 2000,
        consecutive_failures: source.consecutive_failures || 0,
        isVirtual: false,
      })),
      ...hydratedSources,
    ].slice(0, maxSources);

    console.log(`Processing ${sources.length} fetch targets (${storedSources.length} stored + ${hydratedSources.length} hydrated)`);

    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];

    // Build expanded term map for semantic matching
    const expandedTermMap = new Map<string, string>();
    for (const kw of activeKeywords) {
      const expandedTerms = (kw as any).expanded_terms || [];
      for (const et of expandedTerms) {
        expandedTermMap.set(et.toLowerCase(), kw.text);
      }
    }

    let totalInserted = 0;
    let totalErrors = 0;
    const keywordMatchUpdates: Record<string, number> = {};

    const CONCURRENCY = 8;
    for (let i = 0; i < sources.length; i += CONCURRENCY) {
      const batch = sources.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (source: FetchTarget) => {
          try {
            const sourceType = source.source_type || "rss";
            const crawlDelay = source.crawl_delay_ms || 2000;
            let articles: ParsedArticle[] = [];

            if (sourceType === "rss" || sourceType === "atom") {
              const resp = await rateLimitedFetch(source.rss_url, crawlDelay);
              if (!resp.ok) {
                if (source.id) {
                  await supabase.from("sources").update({ health_status: "error", consecutive_failures: (source.consecutive_failures || 0) + 1 }).eq("id", source.id);
                }
                return { sourceId: source.id, sourceName: source.name, domain: source.domain, items: [], error: `HTTP ${resp.status}` };
              }
              articles = parseRSSAtom(await resp.text());
            } else if (sourceType === "sitemap" || sourceType === "news_sitemap") {
              const resp = await rateLimitedFetch(source.rss_url, crawlDelay);
              if (!resp.ok) {
                if (source.id) {
                  await supabase.from("sources").update({ health_status: "error", consecutive_failures: (source.consecutive_failures || 0) + 1 }).eq("id", source.id);
                }
                return { sourceId: source.id, sourceName: source.name, domain: source.domain, items: [], error: `HTTP ${resp.status}` };
              }
              articles = parseSitemap(await resp.text()).slice(0, 50);
            } else if (sourceType === "html") {
              const resp = await rateLimitedFetch(source.rss_url, crawlDelay);
              if (!resp.ok) {
                if (source.id) {
                  await supabase.from("sources").update({ health_status: "error", consecutive_failures: (source.consecutive_failures || 0) + 1 }).eq("id", source.id);
                }
                return { sourceId: source.id, sourceName: source.name, domain: source.domain, items: [], error: `HTTP ${resp.status}` };
              }
              articles = parseHTMLArticles(await resp.text(), new URL(source.rss_url).origin);
            }

            if (source.id) {
              await supabase.from("sources").update({ last_fetched_at: new Date().toISOString(), last_success_at: new Date().toISOString(), health_status: "healthy", consecutive_failures: 0 }).eq("id", source.id);
            }
            return { sourceId: source.id, sourceName: source.name, domain: source.domain, items: articles, error: null };
          } catch (e) {
            console.error(`Error fetching ${source.name}:`, e);
            const failures = (source.consecutive_failures || 0) + 1;
            if (source.id) {
              await supabase.from("sources").update({ health_status: failures >= 4 ? "failing" : "degraded", consecutive_failures: failures }).eq("id", source.id);
            }
            return { sourceId: source.id, sourceName: source.name, domain: source.domain, items: [], error: String(e) };
          }
        })
      );

      for (const result of results) {
        if (result.status === "rejected") { totalErrors++; continue; }
        const { sourceId, sourceName, domain, items, error } = result.value;
        if (error) { totalErrors++; console.log(`Source ${sourceName}: ${error}`); continue; }

        const articlesToInsert = items.map((item: ParsedArticle) => {
          const matchedKws = new Set<string>();
          const nTitle = normalizeText(item.title);
          const nSnippet = normalizeText(item.snippet);
          // Check original keywords
          for (const kw of activeKeywords) {
            const nKw = normalizeText(kw.text);
            if (nTitle.includes(nKw) || nSnippet.includes(nKw)) {
              matchedKws.add(kw.text);
              keywordMatchUpdates[kw.id] = (keywordMatchUpdates[kw.id] || 0) + 1;
            }
          }
          // Check expanded terms
          for (const [term, originalKw] of expandedTermMap) {
            const nTerm = normalizeText(term);
            if (nTitle.includes(nTerm) || nSnippet.includes(nTerm)) {
              if (!matchedKws.has(originalKw)) {
                matchedKws.add(originalKw);
                const kw = activeKeywords.find((k: any) => k.text === originalKw);
                if (kw) keywordMatchUpdates[kw.id] = (keywordMatchUpdates[kw.id] || 0) + 1;
              }
            }
          }
          return {
            title: item.title, snippet: item.snippet.slice(0, 500), url: normalizeUrl(item.url),
            source_id: sourceId,
            source_name: sourceName || null,
            source_domain: domain ? normalizeDomain(domain) : null,
            published_at: item.published_at, fetched_at: new Date().toISOString(),
            matched_keywords: Array.from(matchedKws), language: item.language || null,
          };
        });

        const withKeywords = articlesToInsert.filter((a: any) => a.matched_keywords.length > 0);
        if (withKeywords.length > 0) {
          const missingDates = withKeywords.filter((a: any) => !a.published_at);
          if (missingDates.length > 0) {
            const META_CONCURRENCY = 3;
            for (let m = 0; m < missingDates.length; m += META_CONCURRENCY) {
              const metaBatch = missingDates.slice(m, m + META_CONCURRENCY);
              const metaResults = await Promise.allSettled(metaBatch.map(async (article: any) => {
                const metadata = await fetchArticleMetadata(article.url);
                if (!metadata) return;
                article.published_at = article.published_at || metadata.published_at;
                article.language = article.language || metadata.language;
              }));
              for (const metaResult of metaResults) {
                if (metaResult.status === "rejected") console.warn("Metadata resolution failed:", metaResult.reason);
              }
            }
          }

          withKeywords.forEach((article: any) => {
            article.published_at = article.published_at || new Date().toISOString();
          });
          console.log(`Source ${sourceName}: ${withKeywords.length} keyword-matched / ${items.length} total`);
          const BATCH_SIZE = 10;
          for (let b = 0; b < withKeywords.length; b += BATCH_SIZE) {
            const articleBatch = withKeywords.slice(b, b + BATCH_SIZE);
            const sentiments = await analyzeSentimentBatch(articleBatch.map((a: any) => ({ title: a.title, snippet: a.snippet || "" })), lovableApiKey);
            const withSentiment = articleBatch.map((a: any, idx: number) => ({ ...a, sentiment: sentiments[idx].sentiment, sentiment_score: sentiments[idx].score }));
            const { data: inserted, error: insertErr } = await supabase.from("articles").upsert(withSentiment, { onConflict: "url", ignoreDuplicates: false }).select("id");
            if (insertErr) { console.error("Insert error:", insertErr); totalErrors++; }
            else totalInserted += inserted?.length || 0;
          }
        }
      }
    }

    for (const [kwId, addCount] of Object.entries(keywordMatchUpdates)) {
      const kw = activeKeywords.find((k: any) => k.id === kwId);
      if (kw) await supabase.from("keywords").update({ match_count: kw.match_count + addCount }).eq("id", kwId);
    }

    const summary = { totalInserted, totalErrors, sourcesProcessed: sources.length, hydratedApprovedDomains: hydratedSources.length };
    console.log("Fetch complete:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("fetch-rss error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
