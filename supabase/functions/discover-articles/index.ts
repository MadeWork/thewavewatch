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
  matched_via?: string;
  relevance_score?: number | null;
  primary_entity?: string | null;
  ai_summary?: string | null;
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
        continue;
      }
      return { response: resp, elapsed, attempts: attempt + 1 };
    } catch (e: any) {
      const elapsed = Date.now() - start;
      const isTimeout = e.name === "AbortError" || e.message?.includes("abort");
      lastError = isTimeout ? `timeout (${timeoutMs}ms)` : (e.message || "network error");
      if (attempt < maxRetries) continue;
      return { response: null, elapsed, attempts: attempt + 1, error: lastError };
    }
  }
  return { response: null, elapsed: 0, attempts: maxRetries + 1, error: lastError };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function stripHtml(text: string): string {
  return decodeHtmlEntities(text.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizeText(text: string): string {
  return stripHtml(text).toLowerCase().replace(/[_\-–—]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").trim().toLowerCase();
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

// ── Article body fetcher for deep matching ───────────────

async function fetchArticleBody(url: string): Promise<{ text: string; lang: string | null; publishedAt: string | null } | null> {
  try {
    const { response: resp } = await fetchWithRetry(url, { type: "article", maxRetries: 1, label: `body ${url.slice(0, 50)}` });
    if (!resp?.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) { await resp.text(); return null; }
    const html = await resp.text();
    return {
      text: extractReadableText(html).slice(0, 12000),
      lang: detectLanguage(html),
      publishedAt: extractPublishedAtFromHtml(html) || extractDateFromUrl(url),
    };
  } catch { return null; }
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
  while ((m = re.exec(xml)) !== null && items.length < 200) {
    const url = getXmlTag(m[1], "loc");
    if (!url) continue;
    const title = stripHtml(getXmlTag(m[1], "news:title") || extractTitleFromUrl(url)).slice(0, 220);
    // news:keywords contains tags, not article text — skip it for snippet
    const snippet = "";
    const pubDate = getXmlTag(m[1], "news:publication_date") || getXmlTag(m[1], "lastmod");
    items.push({
      title, url: normalizeUrl(url), snippet,
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
  while ((m = linkRe.exec(html)) !== null && items.length < 50) {
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
  domain: string, name: string, sitemapUrl?: string | null, isTier1 = false
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
    `https://${domain}/sitemap_index.xml`,
  ]) {
    if (!urls.includes(guess)) urls.push(guess);
  }

  let allItems: SitemapItem[] = [];
  const MAX_SITEMAPS = isTier1 ? 6 : 4;
  const MAX_ITEMS = isTier1 ? 200 : 100;
  const MAX_CHILDREN = isTier1 ? 5 : 3;

  for (const smUrl of urls.slice(0, MAX_SITEMAPS)) {
    if (allItems.length >= MAX_ITEMS) break;
    try {
      const { response: resp } = await fetchWithRetry(smUrl, { type: "sitemap", maxRetries: 1, label: `sitemap ${domain}` });
      if (!resp?.ok) { if (resp) await resp.text().catch(() => {}); continue; }
      const xml = await resp.text();

      if (/<sitemapindex/i.test(xml)) {
        const children = parseSitemapIndex(xml).slice(-MAX_CHILDREN);
        for (const childUrl of children) {
          if (allItems.length >= MAX_ITEMS) break;
          try {
            const { response: childResp } = await fetchWithRetry(childUrl, { type: "sitemap", maxRetries: 1, label: `child sitemap ${domain}` });
            if (!childResp?.ok) { if (childResp) await childResp.text().catch(() => {}); continue; }
            const childXml = await childResp.text();
            allItems.push(...parseSitemapItems(childXml, domain, name).slice(-50));
          } catch {}
        }
      } else if (/<urlset/i.test(xml)) {
        allItems.push(...parseSitemapItems(xml, domain, name).slice(-60));
      }
    } catch {}
  }

  // Also try listing page extraction for Tier 1
  if (isTier1) {
    try {
      const { response: resp } = await fetchWithRetry(`https://${domain}`, { type: "listing", maxRetries: 1, label: `listing ${domain}` });
      if (resp?.ok) {
        const html = await resp.text();
        const listingItems = extractListingPageLinks(html, domain, name);
        allItems.push(...listingItems);
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
    if (title && link) items.push({ title: stripHtml(title), url: normalizeUrl(link), snippet: desc, published_at: parseDateValue(pubDate) || extractDateFromUrl(link), source_domain: nd, source_name: sourceName });
  }

  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((m = entryRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getXmlTag(c, "title");
    const linkMatch = c.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : getXmlTag(c, "link");
    const summary = stripHtml(getXmlTag(c, "summary") || getXmlTag(c, "content")).slice(0, 500);
    const updated = getXmlTag(c, "updated") || getXmlTag(c, "published");
    if (title && link) items.push({ title: stripHtml(title), url: normalizeUrl(link), snippet: summary, published_at: parseDateValue(updated) || extractDateFromUrl(link), source_domain: nd, source_name: sourceName });
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
       // Don't block news.google.com URLs here — they'll be resolved to real publisher URLs later
       const isGnUrl = gnLink.includes("news.google.com");
       if (!isGnUrl && (isBlockedDomain(domain) || isBlockedUrl(gnLink))) continue;
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

    const stage = body.stage || "tier1";
    const offset = Number(body.offset ?? 0);
    const limit = Number(body.limit ?? 10);
    // Body scan budget per stage call
    const bodyScanBudget = Math.min(Number(body.body_scan_budget ?? 15), 30);

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
    const CONC = 3;

    function classifyItems(items: SitemapItem[], method: string): { matched: DiscoveredArticle[]; unmatched: RSSItem[] } {
      const matched: DiscoveredArticle[] = [];
      const unmatched: RSSItem[] = [];
      for (const item of items) {
        if (existingUrlSet.has(normalizeUrl(item.url))) continue;
        if (isBlockedDomain(item.source_domain) || isBlockedUrl(item.url)) continue;
        const kws = matchKeywordsExpanded(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
        if (kws.length > 0) matched.push({ ...item, matched_keywords: kws, discovery_method: method, matched_via: "title_snippet" });
        else unmatched.push(item);
      }
      return { matched, unmatched };
    }

    // ── Body scan helper: fetch article bodies for unmatched items and check keywords
    async function bodyScanUnmatched(unmatched: RSSItem[], method: string, budget: number): Promise<DiscoveredArticle[]> {
      const toScan = unmatched.slice(0, budget);
      if (toScan.length === 0) return [];
      console.log(`Body scanning ${toScan.length} unmatched items for keyword matches...`);
      const found: DiscoveredArticle[] = [];
      for (let i = 0; i < toScan.length; i += CONC) {
        const batch = toScan.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async (item) => {
          const body = await fetchArticleBody(item.url);
          if (!body) return null;
          const kws = matchKeywordsExpanded(body.text, searchTerms);
          if (kws.length > 0) {
            return {
              ...item,
              matched_keywords: kws,
              discovery_method: method,
              matched_via: "body_scan",
              language: body.lang,
              published_at: item.published_at || body.publishedAt,
            } as DiscoveredArticle;
          }
          return null;
        }));
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) found.push(r.value);
        }
      }
      console.log(`Body scan found ${found.length} additional matches from ${toScan.length} scanned`);
      return found;
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
          let domainUnmatched: RSSItem[] = [];

          // Feed URL
          if (dom.feed_url) {
            try {
              const { response: resp } = await fetchWithRetry(dom.feed_url, { type: "rss", maxRetries: 1, label: `T1 Feed ${name}` });
              if (resp?.ok) {
                const xml = await resp.text();
                const items = parseRSSItems(xml, domain, name);
                const { matched, unmatched } = classifyItems(items, "rss");
                domainMatched.push(...matched);
                domainUnmatched.push(...unmatched);
              }
            } catch {}
          }

          // Sitemaps + listing page extraction
          try {
            const items = await fetchSitemapItemsForDomain(domain, name, dom.sitemap_url, true);
            if (items.length > 0) {
              const { matched, unmatched } = classifyItems(items, "sitemap");
              domainMatched.push(...matched);
              domainUnmatched.push(...unmatched);
            }
          } catch {}

          return { matched: domainMatched, unmatched: domainUnmatched };
        }));

        for (const r of results) {
          if (r.status === "fulfilled") {
            allDiscovered.push(...r.value.matched);
            allUnmatched.push(...r.value.unmatched);
          }
        }
      }

      // Body scan unmatched Tier 1 items (these are high-value sources)
      const bodyScanResults = await bodyScanUnmatched(allUnmatched, "tier1_body", bodyScanBudget);
      allDiscovered.push(...bodyScanResults);

      const { count } = await supabase
        .from("approved_domains")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .eq("approval_status", "approved")
        .gte("priority", 70);

      const hasMore = (count || 0) > offset + limit;
      console.log(`Tier 1 batch: ${allDiscovered.length} matched (${bodyScanResults.length} from body scan, hasMore=${hasMore})`);

      const inserted = await insertArticles(allDiscovered, existingUrlSet, activeKeywords, searchTerms, expandedTermMap, supabase, lovableApiKey);
      return new Response(JSON.stringify({
        discovered: inserted, stage: "tier1", offset, limit,
        hasMore, totalTier1: count || 0,
        bodyScanned: bodyScanResults.length,
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
        { hl: "en", gl: "NZ", ceid: "NZ:en" },
        { hl: "ja", gl: "JP", ceid: "JP:ja" },
        { hl: "sv", gl: "SE", ceid: "SE:sv" },
        { hl: "fi", gl: "FI", ceid: "FI:fi" },
        { hl: "no", gl: "NO", ceid: "NO:no" },
      ];
      const primaryTerms = activeKeywords.map((k: any) => k.text).slice(0, 8);
      console.log(`Stage google_news: ${primaryTerms.length} keywords × ${regions.length} regions`);

      for (const term of primaryTerms) {
        for (const reg of regions) {
          try {
            const q = encodeURIComponent(term);
            const url = `https://news.google.com/rss/search?q=${q}&hl=${reg.hl}&gl=${reg.gl}&ceid=${reg.ceid}`;
            const { response: resp, error } = await fetchWithRetry(url, { type: "google_news", maxRetries: 1, label: `GN "${term}" ${reg.gl}` });
            if (resp?.ok) {
              const xml = await resp.text();
              const articles = parseGoogleNewsRSS(xml, term);
              console.log(`GN "${term}" ${reg.gl}: ${articles.length} articles parsed from ${xml.length} bytes`);
              allDiscovered.push(...articles);
            } else {
              console.log(`GN "${term}" ${reg.gl}: failed (status=${resp?.status}, error=${error})`);
              if (resp) await resp.text().catch(() => {});
            }
            await new Promise(r => setTimeout(r, 150));
          } catch (e: any) {
            console.log(`GN "${term}" ${reg.gl}: exception: ${e.message}`);
          }
        }
      }

      // Deduplicate by title (GN returns same article across regions)
      console.log(`Google News: ${allDiscovered.length} raw articles before dedup`);
      const gnSeen = new Set<string>();
      allDiscovered = allDiscovered.filter(a => {
        const key = normalizeText(a.title).slice(0, 80);
        if (gnSeen.has(key)) return false;
        gnSeen.add(key);
        return true;
      });

      // Google News URLs can't be reliably resolved (consent redirects).
      // Use the article as-is with the <source> domain. Store GN URL — it still links to the article.
      // Don't filter by isBlockedUrl since GN URLs are on news.google.com
      // Limit to top 50 to stay within compute budget
      allDiscovered = allDiscovered.slice(0, 50);
      console.log(`Google News: ${allDiscovered.length} unique articles ready for insert`);

      const inserted = await insertArticles(allDiscovered, existingUrlSet, activeKeywords, searchTerms, expandedTermMap, supabase, lovableApiKey);
      return new Response(JSON.stringify({
        discovered: inserted, stage: "google_news",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════
    // STAGE: sources — active source feeds with body scanning
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
            const { response: resp, error } = await fetchWithRetry(src.rss_url, { type: "rss", maxRetries: 1, label: `RSS ${src.name}` });
            if (!resp?.ok) {
              await supabase.from("sources").update({
                consecutive_failures: (src.consecutive_failures || 0) + 1,
                health_status: (src.consecutive_failures || 0) + 1 >= 5 ? "degraded" : src.health_status,
              }).eq("id", src.id);
              return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] };
            }
            if (src.consecutive_failures > 0) {
              await supabase.from("sources").update({ consecutive_failures: 0, health_status: "healthy", last_success_at: new Date().toISOString() }).eq("id", src.id);
            }
            const xml = await resp.text();
            const domain = src.domain || normalizeDomain(new URL(src.rss_url).hostname);
            const items = parseRSSItems(xml, domain, src.name);
            const matched: DiscoveredArticle[] = [];
            const unmatched: RSSItem[] = [];
            for (const item of items) {
              if (existingUrlSet.has(normalizeUrl(item.url))) continue;
              const kws = matchKeywordsExpanded(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
              if (kws.length > 0) matched.push({ ...item, matched_keywords: kws, discovery_method: "rss", matched_via: "title_snippet" });
              else unmatched.push(item);
            }
            return { matched, unmatched };
          } catch { return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] }; }
        }));
        for (const r of results) {
          if (r.status === "fulfilled") {
            allDiscovered.push(...r.value.matched);
            allUnmatched.push(...r.value.unmatched);
          }
        }
      }

      // Body scan unmatched items from high-priority sources
      const bodyScanResults = await bodyScanUnmatched(allUnmatched, "rss_body", bodyScanBudget);
      allDiscovered.push(...bodyScanResults);

      const { count } = await supabase
        .from("sources")
        .select("id", { count: "exact", head: true })
        .eq("active", true);

      const hasMore = (count || 0) > offset + limit;
      const inserted = await insertArticles(allDiscovered, existingUrlSet, activeKeywords, searchTerms, expandedTermMap, supabase, lovableApiKey);
      return new Response(JSON.stringify({
        discovered: inserted, stage: "sources", offset, hasMore,
        bodyScanned: bodyScanResults.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════
    // STAGE: tier2 — Tier 2 approved domains with body scanning
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
          let domainMatched: DiscoveredArticle[] = [];
          let domainUnmatched: RSSItem[] = [];

          // Feed first
          if (dom.feed_url) {
            try {
              const { response: resp } = await fetchWithRetry(dom.feed_url, { type: "rss", maxRetries: 1, label: `T2 Feed ${name}` });
              if (resp?.ok) {
                const xml = await resp.text();
                const items = parseRSSItems(xml, domain, name);
                const { matched, unmatched } = classifyItems(items, "feed");
                domainMatched.push(...matched);
                domainUnmatched.push(...unmatched);
              }
            } catch {}
          }

          // Sitemap fallback
          try {
            const items = await fetchSitemapItemsForDomain(domain, name, dom.sitemap_url, false);
            if (items.length > 0) {
              const { matched, unmatched } = classifyItems(items, "sitemap");
              domainMatched.push(...matched);
              domainUnmatched.push(...unmatched);
            }
          } catch {}

          return { matched: domainMatched, unmatched: domainUnmatched };
        }));
        for (const r of results) {
          if (r.status === "fulfilled") {
            allDiscovered.push(...r.value.matched);
            allUnmatched.push(...r.value.unmatched);
          }
        }
      }

      // Body scan for Tier 2 (smaller budget)
      const bodyScanResults = await bodyScanUnmatched(allUnmatched, "tier2_body", Math.min(bodyScanBudget, 10));
      allDiscovered.push(...bodyScanResults);

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
        bodyScanned: bodyScanResults.length,
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
    // Allow Google News URLs (they have valid source_domain from <source> tag)
    const isGnUrl = a.url.includes("news.google.com/rss/articles");
    if (!isGnUrl && (isBlockedDomain(a.source_domain) || isBlockedUrl(a.url))) return false;
    const n = normalizeUrl(a.url);
    if (seen.has(n) || existingUrlSet.has(n)) return false;
    seen.add(n);
    return true;
  });

  if (allDiscovered.length === 0) return 0;
  console.log(`Inserting ${allDiscovered.length} new articles`);

  // Extract published_at from HTML meta tags for articles missing dates
  const needDate = allDiscovered.filter(a => !a.published_at);
  if (needDate.length > 0) {
    console.log(`Extracting dates for ${needDate.length} articles missing published_at`);
    const DATE_CONC = 5;
    for (let d = 0; d < needDate.length; d += DATE_CONC) {
      await Promise.allSettled(needDate.slice(d, d + DATE_CONC).map(async (a) => {
        try {
          const resp = await fetchWithTimeout(a.url, 10000);
          if (!resp?.ok) return;
          const ct = resp.headers.get("content-type") || "";
          if (!ct.includes("text/html") && !ct.includes("xhtml")) { await resp.text(); return; }
          const html = await resp.text();
          a.published_at = extractPublishedAtFromHtml(html) || extractDateFromUrl(a.url) || null;
          if (!a.language) a.language = detectLanguage(html);
        } catch { }
      }));
    }
  }

  // Fetch sources for matching
  const { data: allSources } = await supabase.from("sources").select("id,domain,rss_url,name").eq("active", true).limit(1000);
  const sources = allSources || [];
  const sourceByDomain = new Map(sources.map((s: any) => [normalizeDomain(s.domain || ""), s]));

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
      const matchedSource = sourceByDomain.get(normalizeDomain(a.source_domain));
      return {
        title: stripHtml(a.title), snippet: stripHtml(a.snippet || "").slice(0, 500), url: normalizeUrl(a.url),
        source_id: matchedSource?.id || null,
        source_name: a.source_name || null,
        source_domain: a.source_domain || null,
        published_at: a.published_at || new Date().toISOString(), fetched_at: new Date().toISOString(),
        matched_keywords: a.matched_keywords,
        language: a.language || null,
        sentiment: "neutral" as string, sentiment_score: 0.5,
        discovery_method: a.discovery_method || "rss",
        matched_via: a.matched_via || "title_snippet",
        relevance_score: a.relevance_score ?? null,
        primary_entity: a.primary_entity ?? null,
        ai_summary: a.ai_summary ?? null,
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
