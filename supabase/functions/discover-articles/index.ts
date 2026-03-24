import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Types ────────────────────────────────────────────────

interface DiscoveredArticle {
  title: string;
  snippet: string;
  url: string;
  published_at: string | null;
  source_domain: string;
  source_name: string;
  matched_keywords: string[];
  language?: string | null;
  discovery_method?: string;
}

interface RSSItem {
  title: string;
  url: string;
  snippet: string;
  published_at: string | null;
  source_domain: string;
  source_name: string;
}

// ── Timeout presets ─────────────────────────────────────

const TIMEOUTS = {
  rss: 15000,
  sitemap: 15000,
  listing: 20000,
  article: 25000,
  robots: 6000,
  google_news: 12000,
  resolve: 10000,
  default: 15000,
} as const;

type TimeoutType = keyof typeof TIMEOUTS;

// ── Utilities ────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MediaPulse/1.0)" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(
  url: string,
  opts: { timeout?: number; type?: TimeoutType; maxRetries?: number; label?: string } = {}
): Promise<{ response: Response | null; elapsed: number; attempts: number; error?: string }> {
  const timeoutMs = opts.timeout ?? TIMEOUTS[opts.type ?? "default"];
  const maxRetries = opts.maxRetries ?? 2;
  const label = opts.label ?? url.slice(0, 80);
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
      await new Promise(r => setTimeout(r, backoff));
    }
    const start = Date.now();
    try {
      const resp = await fetchWithTimeout(url, timeoutMs);
      const elapsed = Date.now() - start;
      if (resp.status >= 500 && attempt < maxRetries) {
        lastError = `HTTP ${resp.status}`;
        await resp.text().catch(() => {});
        console.log(`[retry] ${label}: ${lastError}, attempt ${attempt + 1}/${maxRetries + 1} (${elapsed}ms)`);
        continue;
      }
      return { response: resp, elapsed, attempts: attempt + 1 };
    } catch (e: any) {
      const elapsed = Date.now() - start;
      const isTimeout = e.name === "AbortError" || e.message?.includes("abort");
      lastError = isTimeout ? `timeout (${timeoutMs}ms)` : (e.message || "network error");
      if (attempt < maxRetries) {
        console.log(`[retry] ${label}: ${lastError}, attempt ${attempt + 1}/${maxRetries + 1} (${elapsed}ms)`);
        continue;
      }
      return { response: null, elapsed, attempts: attempt + 1, error: lastError };
    }
  }
  return { response: null, elapsed: 0, attempts: maxRetries + 1, error: lastError };
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/&[a-z0-9#]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(text: string): string {
  return stripHtml(text).toLowerCase().replace(/[_\-–—]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

// ── Blocked domains & URL validation ─────────────────────

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
  "news.google.com", "google.com",
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

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "oc", "ref", "fbclid", "gclid"].forEach(p => parsed.searchParams.delete(p));
    parsed.hash = "";
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch { return url; }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())).map(v => v.trim()))];
}

function parseDateValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getXmlTag(content: string, tag: string): string {
  const m = content.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
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

function extractTitleFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
  } catch { return url; }
}

function detectLanguage(html: string): string | null {
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  if (langMatch) return langMatch[1].split("-")[0].toLowerCase();
  return null;
}

function extractReadableText(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (bodyMatch ? bodyMatch[1] : html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPublishedAtFromHtml(html: string): string | null {
  const metaPatterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
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

// ── Google News URL resolver ─────────────────────────────

async function resolveGoogleNewsUrl(gnUrl: string): Promise<string> {
  if (!gnUrl.includes("news.google.com")) return gnUrl;
  try {
    const { response: resp } = await fetchWithRetry(gnUrl, { type: "resolve", maxRetries: 1, label: "GN resolve" });
    if (!resp) return gnUrl;
    const finalUrl = resp.url;
    await resp.text().catch(() => {});
    if (finalUrl && !finalUrl.includes("news.google.com") && !finalUrl.includes("consent.google.com")) {
      return finalUrl;
    }
    return gnUrl;
  } catch {
    return gnUrl;
  }
}

// ── Sitemap helpers ─────────────────────────────────────

interface SitemapItem {
  title: string;
  url: string;
  snippet: string;
  published_at: string | null;
  source_domain: string;
  source_name: string;
}

function parseSitemapIndex(xml: string): string[] {
  const urls: string[] = [];
  const re = /<sitemap>([\s\S]*?)<\/sitemap>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const loc = getXmlTag(m[1], "loc");
    if (loc) urls.push(loc);
  }
  return urls;
}

function parseSitemapItems(xml: string, domain: string, name: string): SitemapItem[] {
  const items: SitemapItem[] = [];
  const re = /<url>([\s\S]*?)<\/url>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = getXmlTag(m[1], "loc");
    if (!url) continue;
    const title = stripHtml(getXmlTag(m[1], "news:title") || extractTitleFromUrl(url)).slice(0, 220);
    const snippet = stripHtml(getXmlTag(m[1], "news:keywords")).slice(0, 500);
    const pubDate = getXmlTag(m[1], "news:publication_date") || getXmlTag(m[1], "lastmod");
    items.push({
      title, url, snippet,
      published_at: parseDateValue(pubDate) || extractDateFromUrl(url),
      source_domain: normalizeDomain(domain),
      source_name: name,
    });
  }
  return items;
}

function extractListingPageLinks(html: string, domain: string, name: string): SitemapItem[] {
  const items: SitemapItem[] = [];
  const linkRe = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const nd = normalizeDomain(domain);
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    const text = stripHtml(m[2]).trim();
    try {
      const u = new URL(href);
      if (normalizeDomain(u.hostname) !== nd) continue;
      const path = u.pathname.toLowerCase();
      const last = path.split("/").filter(Boolean).pop() || "";
      const isArticle = /\/\d{4}\/\d{2}\//.test(path) || /\d{5,}/.test(last) || last.split(/[-_]+/).length >= 4;
      if (!isArticle) continue;
      if (text.length < 15) continue;
      items.push({
        title: text.slice(0, 220), url: href, snippet: "",
        published_at: extractDateFromUrl(href),
        source_domain: nd, source_name: name,
      });
    } catch {}
  }
  return items;
}

async function fetchSitemapItemsForDomain(
  domain: string, name: string, sitemapUrl?: string | null
): Promise<SitemapItem[]> {
  const urls: string[] = [];
  if (sitemapUrl) urls.push(sitemapUrl);

  // robots.txt
  try {
    const { response: resp } = await fetchWithRetry(`https://${domain}/robots.txt`, { type: "robots", maxRetries: 1, label: `robots ${domain}` });
    if (resp?.ok) {
      const txt = await resp.text();
      for (const line of txt.split(/\r?\n/)) {
        const match = line.match(/^Sitemap:\s*(.+)$/i);
        if (match?.[1] && !urls.includes(match[1].trim())) urls.push(match[1].trim());
      }
    }
  } catch {}

  for (const guess of [
    `https://${domain}/sitemap.xml`,
    `https://${domain}/news-sitemap.xml`,
  ]) {
    if (!urls.includes(guess)) urls.push(guess);
  }

  let allItems: SitemapItem[] = [];
  const MAX_SITEMAPS = 4;
  const MAX_ITEMS = 100;
  const MAX_CHILDREN = 3;

  for (const smUrl of urls.slice(0, MAX_SITEMAPS)) {
    if (allItems.length >= MAX_ITEMS) break;
    try {
      const { response: resp, elapsed } = await fetchWithRetry(smUrl, { type: "sitemap", maxRetries: 1, label: `sitemap ${domain}` });
      if (!resp?.ok) { if (resp) await resp.text().catch(() => {}); continue; }
      const xml = await resp.text();
      console.log(`[sitemap] ${domain} ${smUrl.split("/").pop()} fetched in ${elapsed}ms`);

      if (/<sitemapindex/i.test(xml)) {
        const children = parseSitemapIndex(xml).slice(-MAX_CHILDREN);
        for (const childUrl of children) {
          if (allItems.length >= MAX_ITEMS) break;
          try {
            const { response: childResp } = await fetchWithRetry(childUrl, { type: "sitemap", maxRetries: 1, label: `child sitemap ${domain}` });
            if (!childResp?.ok) { if (childResp) await childResp.text().catch(() => {}); continue; }
            const childXml = await childResp.text();
            allItems.push(...parseSitemapItems(childXml, domain, name).slice(-30));
          } catch {}
        }
      } else if (/<urlset/i.test(xml)) {
        allItems.push(...parseSitemapItems(xml, domain, name).slice(-40));
      }
    } catch {}
  }

  return allItems.slice(0, MAX_ITEMS);
}

// ── RSS Parsers ──────────────────────────────────────────

function parseRSSItems(xml: string, domain: string, sourceName: string): RSSItem[] {
  const items: RSSItem[] = [];
  const nd = normalizeDomain(domain);

  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getXmlTag(c, "title");
    const link = getXmlTag(c, "link") || getXmlTag(c, "guid");
    const desc = stripHtml(getXmlTag(c, "description")).slice(0, 500);
    const pubDate = getXmlTag(c, "pubDate") || getXmlTag(c, "dc:date");
    if (title && link) items.push({ title, url: link, snippet: desc, published_at: parseDateValue(pubDate) || extractDateFromUrl(link), source_domain: nd, source_name: sourceName });
  }

  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((m = entryRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getXmlTag(c, "title");
    const linkMatch = c.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : getXmlTag(c, "link");
    const summary = stripHtml(getXmlTag(c, "summary") || getXmlTag(c, "content")).slice(0, 500);
    const updated = getXmlTag(c, "updated") || getXmlTag(c, "published");
    if (title && link) items.push({ title, url: link, snippet: summary, published_at: parseDateValue(updated) || extractDateFromUrl(link), source_domain: nd, source_name: sourceName });
  }
  return items;
}

function parseGoogleNewsRSS(xml: string, keyword: string): DiscoveredArticle[] {
  const articles: DiscoveredArticle[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getXmlTag(c, "title");
    const gnLink = getXmlTag(c, "link");
    const desc = stripHtml(getXmlTag(c, "description")).slice(0, 500);
    const pubDate = getXmlTag(c, "pubDate");
    const srcMatch = c.match(/<source[^>]+url=["']([^"']+)["'][^>]*>(.*?)<\/source>/i);
    if (title && gnLink) {
      let domain = "";
      try { domain = normalizeDomain(srcMatch ? srcMatch[1] : gnLink); } catch {}
      if (isBlockedDomain(domain) || isBlockedUrl(gnLink)) continue;
      articles.push({
        title, snippet: desc, url: gnLink,
        published_at: parseDateValue(pubDate) || extractDateFromUrl(gnLink),
        source_domain: domain, source_name: srcMatch ? stripHtml(srcMatch[2]) : domain,
        matched_keywords: [keyword],
        discovery_method: "google_news",
      });
    }
  }
  return articles;
}

async function fetchArticleDetails(url: string, includeText = true): Promise<{ text: string; lang: string | null; publishedAt: string | null } | null> {
  try {
    const { response: resp, elapsed, attempts, error } = await fetchWithRetry(url, { type: "article", maxRetries: 1, label: `article ${url.slice(0, 60)}` });
    if (!resp?.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) { await resp.text(); return null; }
    const html = await resp.text();
    const lang = detectLanguage(html);
    const publishedAt = extractPublishedAtFromHtml(html) || extractDateFromUrl(url);
    const text = includeText ? extractReadableText(html).slice(0, 12000) : "";
    return { text, lang, publishedAt };
  } catch { return null; }
}

// ── Sentiment ────────────────────────────────────────────

async function analyzeSentimentBatch(items: { title: string; snippet: string }[], apiKey: string): Promise<{ sentiment: string; score: number }[]> {
  if (!items.length) return [];
  const prompt = items.map((it, i) => `[${i}] Title: ${it.title}\nSnippet: ${it.snippet}`).join("\n\n");
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        tools: [{ type: "function", function: { name: "classify_sentiments", description: "Classify sentiment", parameters: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "number" }, sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }, score: { type: "number" } }, required: ["index", "sentiment", "score"] } } }, required: ["results"] } } }],
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

// ── Main ─────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));

    // Stage-based execution to stay within CPU limits:
    // stage=tier1 (offset, limit) — scan Tier 1 domains in batches
    // stage=google_news — Google News RSS
    // stage=sources (offset, limit) — active source feeds
    // stage=tier2 (offset, limit) — Tier 2 approved domains
    const stage = body.stage || "tier1";
    const offset = Number(body.offset ?? 0);
    const limit = Number(body.limit ?? 10);
    const deepScanLimit = Math.min(Number(body.deep_scan_limit ?? 5), 10);

    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (!activeKeywords.length) return new Response(JSON.stringify({ discovered: 0, stage, message: "No active keywords" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: settings } = await supabase.from("settings").select("company_name").limit(1).maybeSingle();

    // Build expanded search terms
    const expandedTermMap = new Map<string, string>();
    for (const kw of activeKeywords) {
      const expandedTerms = (kw as any).expanded_terms || [];
      for (const et of expandedTerms) expandedTermMap.set(et.toLowerCase(), kw.text);
    }

    const searchTerms = uniqueStrings([
      ...activeKeywords.map((k: any) => k.text),
      ...Array.from(expandedTermMap.keys()),
      settings?.company_name && settings.company_name !== "My Company" ? settings.company_name : undefined,
    ]);

    function matchKeywordsExpanded(text: string, terms: string[]): string[] {
      const n = normalizeText(text);
      const matched = new Set<string>();
      for (const term of terms) {
        if (n.includes(normalizeText(term))) {
          const original = expandedTermMap.get(term.toLowerCase()) || term;
          matched.add(original);
        }
      }
      return Array.from(matched);
    }

    // Fetch existing URLs for dedup
    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls || []).map((a: any) => normalizeUrl(a.url)));

    let allDiscovered: DiscoveredArticle[] = [];
    let allUnmatched: RSSItem[] = [];
    const CONC = 3; // reduced concurrency

    function classifyItems(items: SitemapItem[], method: string): { matched: DiscoveredArticle[]; unmatched: RSSItem[] } {
      const matched: DiscoveredArticle[] = [];
      const unmatched: RSSItem[] = [];
      for (const item of items) {
        if (existingUrlSet.has(normalizeUrl(item.url))) continue;
        if (isBlockedDomain(item.source_domain) || isBlockedUrl(item.url)) continue;
        const kws = matchKeywordsExpanded(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
        if (kws.length > 0) matched.push({ ...item, matched_keywords: kws, discovery_method: method });
        else unmatched.push(item);
      }
      return { matched, unmatched };
    }

    // ═══════════════════════════════════════════════════════
    // STAGE: tier1 — scan batch of Tier 1 domains
    // ═══════════════════════════════════════════════════════
    if (stage === "tier1") {
      const { data: allDomains } = await supabase
        .from("approved_domains")
        .select("*")
        .eq("active", true)
        .eq("approval_status", "approved")
        .gte("priority", 70)
        .order("priority", { ascending: false })
        .range(offset, offset + limit - 1);

      const tier1Batch = allDomains || [];
      console.log(`Stage tier1: scanning ${tier1Batch.length} domains (offset=${offset}, limit=${limit})`);

      for (let i = 0; i < tier1Batch.length; i += CONC) {
        const batch = tier1Batch.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async (dom: any) => {
          const domain = normalizeDomain(dom.domain);
          const name = dom.name || domain;
          let domainMatched: DiscoveredArticle[] = [];

          // Feed URL
          if (dom.feed_url) {
            try {
              const { response: resp, elapsed } = await fetchWithRetry(dom.feed_url, { type: "rss", maxRetries: 1, label: `T1 Feed ${name}` });
              if (resp?.ok) {
                const xml = await resp.text();
                const items = parseRSSItems(xml, domain, name);
                const { matched } = classifyItems(items, "rss");
                domainMatched.push(...matched);
              }
            } catch {}
          }

          // Sitemaps (robots.txt → sitemap.xml → news-sitemap.xml)
          try {
            const items = await fetchSitemapItemsForDomain(domain, name, dom.sitemap_url);
            if (items.length > 0) {
              const { matched } = classifyItems(items, "sitemap");
              domainMatched.push(...matched);
            }
          } catch {}

          return domainMatched;
        }));

        for (const r of results) {
          if (r.status === "fulfilled") allDiscovered.push(...r.value);
        }
      }

      // Check if there are more Tier 1 domains
      const { count } = await supabase
        .from("approved_domains")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .eq("approval_status", "approved")
        .gte("priority", 70);

      const hasMore = (count || 0) > offset + limit;
      console.log(`Tier 1 batch: ${allDiscovered.length} matched (hasMore=${hasMore})`);

      // Insert and return
      const inserted = await insertArticles(allDiscovered, existingUrlSet, activeKeywords, searchTerms, expandedTermMap, supabase, lovableApiKey);
      return new Response(JSON.stringify({
        discovered: inserted, stage: "tier1", offset, limit,
        hasMore, totalTier1: count || 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════
    // STAGE: google_news — Google News RSS search
    // ═══════════════════════════════════════════════════════
    if (stage === "google_news") {
      const regions = [
        { hl: "en", gl: "US", ceid: "US:en" },
        { hl: "en", gl: "GB", ceid: "GB:en" },
        { hl: "en", gl: "AU", ceid: "AU:en" },
      ];
      // Use only primary keywords (not expanded terms) to limit queries
      const primaryTerms = activeKeywords.map((k: any) => k.text).slice(0, 5);
      console.log(`Stage google_news: ${primaryTerms.length} keywords × ${regions.length} regions`);

      for (const term of primaryTerms) {
        for (const reg of regions) {
          try {
            const q = encodeURIComponent(term);
            const url = `https://news.google.com/rss/search?q=${q}&hl=${reg.hl}&gl=${reg.gl}&ceid=${reg.ceid}`;
            const { response: resp } = await fetchWithRetry(url, { type: "google_news", maxRetries: 1, label: `GN "${term}" ${reg.gl}` });
            if (resp?.ok) {
              const xml = await resp.text();
              const articles = parseGoogleNewsRSS(xml, term);
              allDiscovered.push(...articles);
            }
            await new Promise(r => setTimeout(r, 200));
          } catch {}
        }
      }

      // Resolve Google News URLs (limit to first 20)
      const gnArticles = allDiscovered.filter(a => a.url.includes("news.google.com")).slice(0, 20);
      for (let i = 0; i < gnArticles.length; i += CONC) {
        const batch = gnArticles.slice(i, i + CONC);
        await Promise.allSettled(batch.map(async (article) => {
          const resolved = await resolveGoogleNewsUrl(article.url);
          if (resolved !== article.url) {
            article.url = resolved;
            try {
              const resolvedDomain = normalizeDomain(new URL(resolved).hostname);
              if (!isBlockedDomain(resolvedDomain)) article.source_domain = resolvedDomain;
            } catch {}
          }
        }));
      }

      const inserted = await insertArticles(allDiscovered, existingUrlSet, activeKeywords, searchTerms, expandedTermMap, supabase, lovableApiKey);
      return new Response(JSON.stringify({
        discovered: inserted, stage: "google_news",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════
    // STAGE: sources — active source feeds
    // ═══════════════════════════════════════════════════════
    if (stage === "sources") {
      const { data: sources } = await supabase
        .from("sources")
        .select("*")
        .eq("active", true)
        .order("fetch_priority", { ascending: false })
        .range(offset, offset + limit - 1);

      const srcBatch = sources || [];
      console.log(`Stage sources: scanning ${srcBatch.length} feeds (offset=${offset})`);

      for (let i = 0; i < srcBatch.length; i += CONC) {
        const batch = srcBatch.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async (src: any) => {
          try {
            const { response: resp, elapsed, error } = await fetchWithRetry(src.rss_url, { type: "rss", maxRetries: 1, label: `RSS ${src.name}` });
            if (!resp?.ok) {
              await supabase.from("sources").update({
                consecutive_failures: (src.consecutive_failures || 0) + 1,
                health_status: (src.consecutive_failures || 0) + 1 >= 5 ? "degraded" : src.health_status,
              }).eq("id", src.id);
              return [];
            }
            if (src.consecutive_failures > 0) {
              await supabase.from("sources").update({ consecutive_failures: 0, health_status: "healthy", last_success_at: new Date().toISOString() }).eq("id", src.id);
            }
            const xml = await resp.text();
            const domain = src.domain || normalizeDomain(new URL(src.rss_url).hostname);
            const items = parseRSSItems(xml, domain, src.name);
            const matched: DiscoveredArticle[] = [];
            for (const item of items) {
              const kws = matchKeywordsExpanded(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
              if (kws.length > 0) matched.push({ ...item, matched_keywords: kws, discovery_method: "rss" });
            }
            return matched;
          } catch { return []; }
        }));
        for (const r of results) {
          if (r.status === "fulfilled") allDiscovered.push(...r.value);
        }
      }

      const { count } = await supabase
        .from("sources")
        .select("id", { count: "exact", head: true })
        .eq("active", true);

      const hasMore = (count || 0) > offset + limit;
      const inserted = await insertArticles(allDiscovered, existingUrlSet, activeKeywords, searchTerms, expandedTermMap, supabase, lovableApiKey);
      return new Response(JSON.stringify({
        discovered: inserted, stage: "sources", offset, hasMore,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════
    // STAGE: tier2 — Tier 2 approved domains
    // ═══════════════════════════════════════════════════════
    if (stage === "tier2") {
      const { data: t2Domains } = await supabase
        .from("approved_domains")
        .select("*")
        .eq("active", true)
        .eq("approval_status", "approved")
        .lt("priority", 70)
        .order("priority", { ascending: false })
        .range(offset, offset + limit - 1);

      const t2Batch = t2Domains || [];
      console.log(`Stage tier2: scanning ${t2Batch.length} domains (offset=${offset})`);

      for (let i = 0; i < t2Batch.length; i += CONC) {
        const batch = t2Batch.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async (dom: any) => {
          const domain = normalizeDomain(dom.domain);
          const name = dom.name || domain;

          // Feed first
          if (dom.feed_url) {
            try {
              const { response: resp } = await fetchWithRetry(dom.feed_url, { type: "rss", maxRetries: 1, label: `T2 Feed ${name}` });
              if (resp?.ok) {
                const xml = await resp.text();
                const items = parseRSSItems(xml, domain, name);
                const { matched } = classifyItems(items, "feed");
                if (matched.length > 0) return matched;
              }
            } catch {}
          }

          // Sitemap fallback
          try {
            const items = await fetchSitemapItemsForDomain(domain, name, dom.sitemap_url);
            if (items.length > 0) {
              const { matched } = classifyItems(items, "sitemap");
              return matched;
            }
          } catch {}

          return [] as DiscoveredArticle[];
        }));
        for (const r of results) {
          if (r.status === "fulfilled") allDiscovered.push(...r.value);
        }
      }

      const { count } = await supabase
        .from("approved_domains")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .eq("approval_status", "approved")
        .lt("priority", 70);

      const hasMore = (count || 0) > offset + limit;
      const inserted = await insertArticles(allDiscovered, existingUrlSet, activeKeywords, searchTerms, expandedTermMap, supabase, lovableApiKey);
      return new Response(JSON.stringify({
        discovered: inserted, stage: "tier2", offset, hasMore,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown stage", stage }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("discover-articles error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// ── Insert helper ────────────────────────────────────────

async function insertArticles(
  allDiscovered: DiscoveredArticle[],
  existingUrlSet: Set<string>,
  activeKeywords: any[],
  searchTerms: string[],
  expandedTermMap: Map<string, string>,
  supabase: any,
  lovableApiKey: string,
): Promise<number> {
  // Dedup
  const seen = new Set<string>();
  allDiscovered = allDiscovered.filter(a => {
    if (isBlockedDomain(a.source_domain) || isBlockedUrl(a.url)) return false;
    const n = normalizeUrl(a.url);
    if (seen.has(n) || existingUrlSet.has(n)) return false;
    seen.add(n);
    return true;
  });

  if (allDiscovered.length === 0) return 0;
  console.log(`Inserting ${allDiscovered.length} new articles`);

  // Fetch sources for matching
  const { data: allSources } = await supabase.from("sources").select("id,domain,rss_url,name").eq("active", true).limit(500);
  const sources = allSources || [];

  let totalInserted = 0;
  const keywordMatchUpdates: Record<string, number> = {};
  const BATCH = 10;

  for (let b = 0; b < allDiscovered.length; b += BATCH) {
    const batch = allDiscovered.slice(b, b + BATCH);
    const toInsert = batch.map(a => {
      for (const kw of a.matched_keywords) {
        const k = activeKeywords.find((x: any) => x.text === kw);
        if (k) keywordMatchUpdates[k.id] = (keywordMatchUpdates[k.id] || 0) + 1;
      }
      const matchedSource = sources.find((s: any) =>
        normalizeDomain(s.domain || "") === normalizeDomain(a.source_domain)
        || (s.rss_url && normalizeDomain(new URL(s.rss_url).hostname) === normalizeDomain(a.source_domain))
      );
      return {
        title: a.title, snippet: (a.snippet || "").slice(0, 500), url: a.url,
        source_id: matchedSource?.id || null,
        source_name: a.source_name || null,
        source_domain: a.source_domain || null,
        published_at: a.published_at || new Date().toISOString(), fetched_at: new Date().toISOString(),
        matched_keywords: a.matched_keywords,
        language: a.language || null,
        sentiment: "neutral" as string, sentiment_score: 0.5,
        discovery_method: a.discovery_method || "rss",
        matched_via: "title_snippet",
      };
    });

    const sentiments = await analyzeSentimentBatch(toInsert.map(a => ({ title: a.title, snippet: a.snippet || "" })), lovableApiKey);
    toInsert.forEach((a, i) => { a.sentiment = sentiments[i].sentiment; a.sentiment_score = sentiments[i].score; });

    const { data: ins, error } = await supabase.from("articles").upsert(toInsert, { onConflict: "url", ignoreDuplicates: true }).select("id");
    if (error) console.error("Insert error:", error);
    else totalInserted += ins?.length || 0;
  }

  for (const [id, count] of Object.entries(keywordMatchUpdates)) {
    const kw = activeKeywords.find((k: any) => k.id === id);
    if (kw) await supabase.from("keywords").update({ match_count: (kw as any).match_count + count }).eq("id", id);
  }

  // Auto-discover new domains
  const knownDomains = new Set(sources.map((s: any) => normalizeDomain(s.domain || "")));
  const newDomains = new Map<string, { name: string; count: number }>();
  for (const a of allDiscovered) {
    if (a.source_domain) {
      const key = normalizeDomain(a.source_domain);
      if (!knownDomains.has(key) && !isBlockedDomain(key)) {
        const ex = newDomains.get(key);
        if (ex) ex.count++; else newDomains.set(key, { name: a.source_name, count: 1 });
      }
    }
  }
  if (newDomains.size > 0) {
    const candidates = Array.from(newDomains.entries()).map(([domain, info]) => ({
      domain, name: info.name || domain, approval_status: "pending", auto_discovered: true, active: false, priority: 30,
    }));
    const { data: existingDoms } = await supabase.from("approved_domains").select("domain").in("domain", candidates.map(c => c.domain));
    const existSet = new Set((existingDoms || []).map((d: any) => normalizeDomain(d.domain)));
    const trulyNew = candidates.filter(c => !existSet.has(normalizeDomain(c.domain)));
    if (trulyNew.length > 0) {
      await supabase.from("approved_domains").insert(trulyNew);
      console.log(`Auto-discovered ${trulyNew.length} new domains`);
    }
  }

  return totalInserted;
}
