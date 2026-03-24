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

// ── Tier-aware timeout presets ───────────────────────────

const TIMEOUTS_TIER1 = {
  rss: 20000,
  sitemap: 20000,
  listing: 25000,
  article: 30000,
  robots: 8000,
  google_news: 12000,
  resolve: 12000,
  default: 20000,
} as const;

const TIMEOUTS_DEFAULT = {
  rss: 15000,
  sitemap: 15000,
  listing: 20000,
  article: 25000,
  robots: 6000,
  google_news: 12000,
  resolve: 10000,
  default: 15000,
} as const;

type TimeoutType = keyof typeof TIMEOUTS_DEFAULT;

// ── Tier config ─────────────────────────────────────────

const TIER1_PRIORITY_THRESHOLD = 70; // approved_domains with priority >= 70 are Tier 1
const TIER1_MAX_SITEMAP_ITEMS = 200;
const TIER1_MAX_SITEMAPS = 6;
const TIER1_MAX_CHILD_SITEMAPS = 5;
const TIER1_MAX_RETRIES = 3;

const DEFAULT_MAX_SITEMAP_ITEMS = 100;
const DEFAULT_MAX_SITEMAPS = 4;
const DEFAULT_MAX_CHILD_SITEMAPS = 3;
const DEFAULT_MAX_RETRIES = 2;

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
  opts: { timeout?: number; type?: TimeoutType; maxRetries?: number; label?: string; tier1?: boolean } = {}
): Promise<{ response: Response | null; elapsed: number; attempts: number; error?: string }> {
  const timeouts = opts.tier1 ? TIMEOUTS_TIER1 : TIMEOUTS_DEFAULT;
  const timeoutMs = opts.timeout ?? timeouts[opts.type ?? "default"];
  const maxRetries = opts.maxRetries ?? (opts.tier1 ? TIER1_MAX_RETRIES : DEFAULT_MAX_RETRIES);
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

function matchKeywords(text: string, keywords: string[]): string[] {
  const n = normalizeText(text);
  return keywords.filter(kw => n.includes(normalizeText(kw)));
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

// ── Sitemap helpers (tier-aware) ─────────────────────────

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

async function discoverSitemapUrlsForDomain(domain: string, sitemapUrl?: string | null, isTier1 = false): Promise<string[]> {
  const urls: string[] = [];
  if (sitemapUrl) urls.push(sitemapUrl);

  try {
    const { response: resp } = await fetchWithRetry(`https://${domain}/robots.txt`, { type: "robots", tier1: isTier1, maxRetries: isTier1 ? 2 : 1, label: `robots.txt ${domain}` });
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
    `https://${domain}/sitemap-news.xml`,
  ]) {
    if (!urls.includes(guess)) urls.push(guess);
  }

  return urls;
}

async function fetchSitemapItemsForDomain(
  domain: string, name: string, sitemapUrl?: string | null, isTier1 = false
): Promise<SitemapItem[]> {
  const sitemapUrls = await discoverSitemapUrlsForDomain(domain, sitemapUrl, isTier1);
  const maxSitemaps = isTier1 ? TIER1_MAX_SITEMAPS : DEFAULT_MAX_SITEMAPS;
  const maxChildren = isTier1 ? TIER1_MAX_CHILD_SITEMAPS : DEFAULT_MAX_CHILD_SITEMAPS;
  const maxItems = isTier1 ? TIER1_MAX_SITEMAP_ITEMS : DEFAULT_MAX_SITEMAP_ITEMS;
  let allItems: SitemapItem[] = [];

  for (const smUrl of sitemapUrls.slice(0, maxSitemaps)) {
    if (allItems.length >= maxItems) break;
    try {
      const { response: resp, elapsed } = await fetchWithRetry(smUrl, { type: "sitemap", tier1: isTier1, label: `sitemap ${domain}` });
      if (!resp?.ok) { if (resp) await resp.text().catch(() => {}); continue; }
      const xml = await resp.text();
      console.log(`[sitemap] ${domain} ${smUrl.split("/").pop()} fetched in ${elapsed}ms`);

      if (/<sitemapindex/i.test(xml)) {
        const children = parseSitemapIndex(xml).slice(-maxChildren);
        for (const childUrl of children) {
          if (allItems.length >= maxItems) break;
          try {
            const { response: childResp } = await fetchWithRetry(childUrl, { type: "sitemap", tier1: isTier1, label: `child sitemap ${domain}` });
            if (!childResp?.ok) { if (childResp) await childResp.text().catch(() => {}); continue; }
            const childXml = await childResp.text();
            const perChild = isTier1 ? 50 : 30;
            allItems.push(...parseSitemapItems(childXml, domain, name).slice(-perChild));
          } catch {}
        }
      } else if (/<urlset/i.test(xml)) {
        const perSitemap = isTier1 ? 60 : 40;
        allItems.push(...parseSitemapItems(xml, domain, name).slice(-perSitemap));
      }
    } catch {}
  }

  return allItems.slice(0, maxItems);
}

async function fetchListingPageItems(domain: string, name: string, isTier1 = false): Promise<SitemapItem[]> {
  const paths = isTier1
    ? ["/", "/news", "/latest", "/articles", "/press", "/media", "/press-releases"]
    : ["/", "/news", "/latest", "/articles"];
  let items: SitemapItem[] = [];
  const maxItems = isTier1 ? 50 : 30;
  for (const path of paths) {
    if (items.length >= maxItems) break;
    try {
      const { response: resp, elapsed } = await fetchWithRetry(`https://${domain}${path}`, { type: "listing", tier1: isTier1, label: `listing ${domain}${path}` });
      if (!resp?.ok) continue;
      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("text/html")) { await resp.text(); continue; }
      const html = await resp.text();
      console.log(`[listing] ${domain}${path} fetched in ${elapsed}ms`);
      items.push(...extractListingPageLinks(html, domain, name));
    } catch {}
  }
  return items.slice(0, maxItems);
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

async function fetchArticleDetails(url: string, includeText = true, isTier1 = false): Promise<{ text: string; lang: string | null; publishedAt: string | null } | null> {
  try {
    const { response: resp, elapsed, attempts, error } = await fetchWithRetry(url, { type: "article", tier1: isTier1, label: `article ${normalizeDomain(new URL(url).hostname)}` });
    if (!resp?.ok) {
      if (error) console.log(`[article] ${url.slice(0, 60)}: failed after ${attempts} attempts: ${error}`);
      return null;
    }
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) { await resp.text(); return null; }
    const html = await resp.text();
    if (attempts > 1) console.log(`[article] ${url.slice(0, 60)}: succeeded on attempt ${attempts} (${elapsed}ms)`);
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

// ── Paginated query helper ───────────────────────────────

async function fetchAllRows(supabase: any, table: string, filters: Record<string, any>, orderBy?: { col: string; asc: boolean }): Promise<any[]> {
  const PAGE = 500;
  let all: any[] = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select("*");
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    if (orderBy) q = q.order(orderBy.col, { ascending: orderBy.asc });
    q = q.range(offset, offset + PAGE - 1);
    const { data, error } = await q;
    if (error) { console.error(`fetchAllRows ${table} error:`, error); break; }
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
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
    const deepScanLimit = Math.max(0, Number(body.deep_scan_limit ?? 50));
    const debug = Boolean(body.debug);

    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (!activeKeywords.length) return new Response(JSON.stringify({ discovered: 0, message: "No active keywords" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: settings } = await supabase.from("settings").select("company_name").limit(1).maybeSingle();

    // Build expanded search terms map
    const expandedTermMap = new Map<string, string>();
    for (const kw of activeKeywords) {
      const expandedTerms = (kw as any).expanded_terms || [];
      for (const et of expandedTerms) {
        expandedTermMap.set(et.toLowerCase(), kw.text);
      }
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

    // Fetch ALL existing URLs for dedup
    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls || []).map((a: any) => normalizeUrl(a.url)));

    // Fetch ALL sources and approved domains (no limits)
    const allSources = await fetchAllRows(supabase, "sources", { active: true });
    const allDomains = await fetchAllRows(supabase, "approved_domains", { active: true, approval_status: "approved" }, { col: "priority", asc: false });

    // Split domains into tiers
    const tier1Domains = allDomains.filter((d: any) => (d.priority || 0) >= TIER1_PRIORITY_THRESHOLD);
    const tier2Domains = allDomains.filter((d: any) => (d.priority || 0) < TIER1_PRIORITY_THRESHOLD);

    let allDiscovered: DiscoveredArticle[] = [];
    let allUnmatched: RSSItem[] = [];
    const logs: string[] = [];
    const CONC = 5;

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

    // ══════════════════════════════════════════════════════
    // STEP 1: TIER 1 — Major outlets get full multi-method discovery
    // ══════════════════════════════════════════════════════

    console.log(`Step 1: Tier 1 full scan for ${tier1Domains.length} major outlets...`);
    let tier1Discovered = 0;

    for (let i = 0; i < tier1Domains.length; i += CONC) {
      const batch = tier1Domains.slice(i, i + CONC);
      const results = await Promise.allSettled(batch.map(async (dom: any) => {
        const domain = normalizeDomain(dom.domain);
        const name = dom.name || domain;
        let domainMatched: DiscoveredArticle[] = [];
        let domainUnmatched: RSSItem[] = [];

        // 1a. Feed URL
        if (dom.feed_url) {
          try {
            const { response: resp, elapsed } = await fetchWithRetry(dom.feed_url, { type: "rss", tier1: true, label: `T1 Feed ${name}` });
            if (resp?.ok) {
              const xml = await resp.text();
              const items = parseRSSItems(xml, domain, name);
              const { matched, unmatched } = classifyItems(items, "rss");
              domainMatched.push(...matched);
              domainUnmatched.push(...unmatched);
              logs.push(`T1 Feed ${name}: ${items.length} items, ${matched.length} matched [${elapsed}ms]`);
            }
          } catch {}
        }

        // 1b-e. Sitemap discovery (robots.txt → sitemap.xml → news-sitemap.xml → index traversal)
        try {
          const items = await fetchSitemapItemsForDomain(domain, name, dom.sitemap_url, true);
          if (items.length > 0) {
            const { matched, unmatched } = classifyItems(items, "sitemap");
            domainMatched.push(...matched);
            domainUnmatched.push(...unmatched);
            logs.push(`T1 Sitemap ${name}: ${items.length} items, ${matched.length} matched`);
          }
        } catch {}

        // 1f. Listing page extraction (fallback or supplement)
        try {
          const listingItems = await fetchListingPageItems(domain, name, true);
          if (listingItems.length > 0) {
            const { matched, unmatched } = classifyItems(listingItems, "listing_page");
            domainMatched.push(...matched);
            domainUnmatched.push(...unmatched);
            logs.push(`T1 Listing ${name}: ${listingItems.length} items, ${matched.length} matched`);
          }
        } catch {}

        return { matched: domainMatched, unmatched: domainUnmatched };
      }));

      for (const r of results) {
        if (r.status === "fulfilled") {
          allDiscovered.push(...r.value.matched);
          allUnmatched.push(...r.value.unmatched);
          tier1Discovered += r.value.matched.length;
        }
      }
      if (i + CONC < tier1Domains.length) await new Promise(r => setTimeout(r, 200));
    }
    console.log(`Tier 1 scan complete: ${tier1Discovered} matched articles from ${tier1Domains.length} outlets`);

    // ══════════════════════════════════════════════════════
    // STEP 2: Google News RSS (multi-region)
    // ══════════════════════════════════════════════════════

    const regions = [
      { hl: "en", gl: "US", ceid: "US:en" },
      { hl: "en", gl: "GB", ceid: "GB:en" },
      { hl: "en", gl: "AU", ceid: "AU:en" },
      { hl: "en", gl: "NZ", ceid: "NZ:en" },
      { hl: "ja", gl: "JP", ceid: "JP:ja" },
      { hl: "pt", gl: "PT", ceid: "PT:pt" },
      { hl: "de", gl: "DE", ceid: "DE:de" },
      { hl: "fr", gl: "FR", ceid: "FR:fr" },
      { hl: "en", gl: "IE", ceid: "IE:en" },
    ];
    console.log(`Step 2: Google News for ${searchTerms.length} keywords across ${regions.length} regions...`);
    for (const term of searchTerms) {
      for (const reg of regions) {
        try {
          const q = encodeURIComponent(term);
          const url = `https://news.google.com/rss/search?q=${q}&hl=${reg.hl}&gl=${reg.gl}&ceid=${reg.ceid}`;
          const { response: resp, elapsed, attempts, error } = await fetchWithRetry(url, { type: "google_news", maxRetries: 1, label: `GN "${term}" ${reg.gl}` });
          if (resp?.ok) {
            const xml = await resp.text();
            const articles = parseGoogleNewsRSS(xml, term);
            logs.push(`Google News "${term}" (${reg.gl}): ${articles.length} [${elapsed}ms]`);
            allDiscovered.push(...articles);
          } else {
            logs.push(`Google News "${term}" (${reg.gl}): ${error || "failed"}`);
          }
          await new Promise(r => setTimeout(r, 300));
        } catch (e: any) {
          logs.push(`Google News "${term}" (${reg.gl}) error: ${e.message}`);
        }
      }
    }

    // Resolve Google News URLs to canonical publisher URLs
    console.log(`Resolving ${allDiscovered.filter(a => a.url.includes("news.google.com")).length} Google News URLs...`);
    const gnArticles = allDiscovered.filter(a => a.url.includes("news.google.com"));
    for (let i = 0; i < gnArticles.length; i += CONC) {
      const batch = gnArticles.slice(i, i + CONC);
      await Promise.allSettled(batch.map(async (article) => {
        const resolved = await resolveGoogleNewsUrl(article.url);
        if (resolved !== article.url) {
          article.url = resolved;
          try {
            const resolvedDomain = normalizeDomain(new URL(resolved).hostname);
            if (!isBlockedDomain(resolvedDomain)) {
              article.source_domain = resolvedDomain;
            }
          } catch {}
        }
      }));
    }

    // ══════════════════════════════════════════════════════
    // STEP 3: Active source feeds (ALL sources)
    // ══════════════════════════════════════════════════════

    if (allSources.length > 0) {
      console.log(`Step 3: Scanning ${allSources.length} active source feeds...`);
      for (let i = 0; i < allSources.length; i += CONC) {
        const batch = allSources.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async (src: any) => {
          try {
            const { response: resp, elapsed, attempts, error } = await fetchWithRetry(src.rss_url, { type: "rss", maxRetries: 2, label: `RSS ${src.name}` });
            if (!resp?.ok) {
              logs.push(`Source ${src.name}: ${error || `HTTP ${resp?.status}`} [${elapsed}ms, ${attempts} attempts]`);
              await supabase.from("sources").update({
                consecutive_failures: (src.consecutive_failures || 0) + 1,
                health_status: (src.consecutive_failures || 0) + 1 >= 5 ? "degraded" : src.health_status,
              }).eq("id", src.id);
              return { matched: [], unmatched: [] };
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
              const kws = matchKeywordsExpanded(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
              if (kws.length > 0) matched.push({ ...item, matched_keywords: kws, discovery_method: "rss" });
              else unmatched.push(item);
            }
            logs.push(`Source ${src.name}: ${items.length} items, ${matched.length} matched [${elapsed}ms]`);
            return { matched, unmatched };
          } catch { return { matched: [], unmatched: [] }; }
        }));
        for (const r of results) {
          if (r.status === "fulfilled") { allDiscovered.push(...r.value.matched); allUnmatched.push(...r.value.unmatched); }
        }
        if (i + CONC < allSources.length) await new Promise(r => setTimeout(r, 150));
      }
    }

    // ══════════════════════════════════════════════════════
    // STEP 4: Tier 2 approved domains — feeds + sitemaps
    // ══════════════════════════════════════════════════════

    if (tier2Domains.length > 0) {
      console.log(`Step 4: Tier 2 scan for ${tier2Domains.length} approved domains...`);

      // 4a. Domain feeds
      const t2WithFeeds = tier2Domains.filter((d: any) => d.feed_url);
      for (let i = 0; i < t2WithFeeds.length; i += CONC) {
        const batch = t2WithFeeds.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async (dom: any) => {
          try {
            const { response: resp, elapsed } = await fetchWithRetry(dom.feed_url, { type: "rss", label: `T2 Feed ${dom.name}` });
            if (!resp?.ok) return { matched: [], unmatched: [] };
            const xml = await resp.text();
            const items = parseRSSItems(xml, dom.domain, dom.name);
            const { matched, unmatched } = classifyItems(items, "feed");
            logs.push(`T2 Feed ${dom.name}: ${items.length} items, ${matched.length} matched [${elapsed}ms]`);
            return { matched, unmatched };
          } catch { return { matched: [], unmatched: [] }; }
        }));
        for (const r of results) {
          if (r.status === "fulfilled") { allDiscovered.push(...r.value.matched); allUnmatched.push(...r.value.unmatched); }
        }
      }

      // 4b. Sitemap discovery for Tier 2
      let t2SitemapMatched = 0;
      for (let i = 0; i < tier2Domains.length; i += CONC) {
        const batch = tier2Domains.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async (dom: any) => {
          const domain = normalizeDomain(dom.domain);
          try {
            const items = await fetchSitemapItemsForDomain(domain, dom.name, dom.sitemap_url, false);
            if (items.length === 0) {
              const listingItems = await fetchListingPageItems(domain, dom.name, false);
              return classifyItems(listingItems, "listing_page");
            }
            return classifyItems(items, "sitemap");
          } catch { return { matched: [], unmatched: [] }; }
        }));
        for (const r of results) {
          if (r.status === "fulfilled") {
            allDiscovered.push(...r.value.matched);
            allUnmatched.push(...r.value.unmatched);
            t2SitemapMatched += r.value.matched.length;
          }
        }
        if (i + CONC < tier2Domains.length) await new Promise(r => setTimeout(r, 200));
      }
      console.log(`Tier 2 discovery: ${t2SitemapMatched} sitemap-matched articles`);
    }

    // ══════════════════════════════════════════════════════
    // STEP 5: Deep scan unmatched — prioritize Tier 1
    // ══════════════════════════════════════════════════════

    let deepScanned = 0;
    if (deepScanLimit > 0 && allUnmatched.length > 0) {
      const tier1DomainSet = new Set(tier1Domains.map((d: any) => normalizeDomain(d.domain)));
      const sortedUnmatched = allUnmatched
        .filter(item => !existingUrlSet.has(normalizeUrl(item.url)))
        .sort((a, b) => {
          const aPri = tier1DomainSet.has(normalizeDomain(a.source_domain)) ? 1 : 0;
          const bPri = tier1DomainSet.has(normalizeDomain(b.source_domain)) ? 1 : 0;
          if (aPri !== bPri) return bPri - aPri;
          return new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime();
        })
        .slice(0, deepScanLimit);

      console.log(`Step 5: Deep scanning ${sortedUnmatched.length} article bodies (Tier 1 prioritized)...`);
      for (let i = 0; i < sortedUnmatched.length; i += 3) {
        const batch = sortedUnmatched.slice(i, i + 3);
        const results = await Promise.allSettled(batch.map(async item => {
          deepScanned++;
          const isTier1Item = tier1DomainSet.has(normalizeDomain(item.source_domain));
          const result = await fetchArticleDetails(item.url, true, isTier1Item);
          if (!result) return null;
          const kws = matchKeywordsExpanded(result.text, searchTerms);
          if (kws.length > 0) {
            return {
              ...item,
              matched_keywords: kws,
              language: result.lang,
              published_at: item.published_at || result.publishedAt,
              discovery_method: "body_scan",
            } as DiscoveredArticle;
          }
          return null;
        }));
        for (const r of results) { if (r.status === "fulfilled" && r.value) allDiscovered.push(r.value); }
      }
    }

    // ── Dedup ────────────────────────────────────────────
    console.log(`Total candidates before dedup: ${allDiscovered.length}`);
    const seen = new Set<string>();
    allDiscovered = allDiscovered.filter(a => {
      if (isBlockedDomain(a.source_domain) || isBlockedUrl(a.url)) return false;
      const n = normalizeUrl(a.url);
      if (seen.has(n) || existingUrlSet.has(n)) return false;
      seen.add(n);
      return true;
    });
    console.log(`After dedup: ${allDiscovered.length} new articles`);

    // ── Resolve missing publication dates ────────────────
    const unresolvedDates = allDiscovered.filter(a => !a.published_at);
    if (unresolvedDates.length > 0) {
      console.log(`Resolving dates for ${unresolvedDates.length} articles...`);
      for (let i = 0; i < unresolvedDates.length; i += 3) {
        const batch = unresolvedDates.slice(i, i + 3);
        await Promise.allSettled(batch.map(async article => {
          const details = await fetchArticleDetails(article.url, false);
          if (details) {
            article.published_at = article.published_at || details.publishedAt;
            article.language = article.language || details.lang;
          }
        }));
      }
    }

    // ── Auto-discover new domains ────────────────────────
    const knownDomains = new Set([
      ...allSources.map((s: any) => normalizeDomain(s.domain || "")),
      ...allDomains.map((d: any) => normalizeDomain(d.domain)),
    ]);
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

    // ── Insert ───────────────────────────────────────────
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
        const matchedSource = allSources.find((s: any) =>
          normalizeDomain(s.domain || "") === normalizeDomain(a.source_domain)
          || (s.rss_url && normalizeDomain(new URL(s.rss_url).hostname) === normalizeDomain(a.source_domain))
        );
        return {
          title: a.title, snippet: a.snippet.slice(0, 500), url: a.url,
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

    const summary = {
      discovered: totalInserted,
      totalCandidates: allDiscovered.length,
      tier1Discovered,
      deepScanned,
      newDomainsFound: newDomains.size,
      sourcesScanned: allSources.length,
      tier1Domains: tier1Domains.length,
      tier2Domains: tier2Domains.length,
      keywordsUsed: searchTerms,
      methods: ["tier1_full_scan", "google_news_rss", "source_feeds", "tier2_feeds", "tier2_sitemaps", deepScanLimit > 0 ? "deep_scan" : null].filter(Boolean),
    };
    console.log("Discovery complete:", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("discover-articles error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
