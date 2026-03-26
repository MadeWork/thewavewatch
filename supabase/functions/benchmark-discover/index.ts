import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface BenchmarkSource {
  domain: string;
  name: string;
  region: string;
  feed_url?: string;
  sitemap_url?: string;
}

const BENCHMARK_SOURCES: BenchmarkSource[] = [
  { domain: "euronews.com", name: "Euronews", region: "EU", feed_url: "https://www.euronews.com/rss" },
  { domain: "reuters.com", name: "Reuters", region: "EU", feed_url: "https://www.reuters.com/arc/outboundfeeds/rss/" },
  { domain: "bbc.com", name: "BBC News", region: "UK", feed_url: "http://feeds.bbci.co.uk/news/rss.xml" },
  { domain: "theguardian.com", name: "The Guardian", region: "UK", feed_url: "https://www.theguardian.com/world/rss" },
  { domain: "ft.com", name: "Financial Times", region: "UK" },
  { domain: "dw.com", name: "Deutsche Welle", region: "EU", feed_url: "https://rss.dw.com/rdf/rss-en-all" },
  { domain: "france24.com", name: "France 24", region: "EU", feed_url: "https://www.france24.com/en/rss" },
  { domain: "politico.eu", name: "Politico Europe", region: "EU", feed_url: "https://www.politico.eu/feed/" },
  { domain: "euractiv.com", name: "EurActiv", region: "EU", feed_url: "https://www.euractiv.com/feed/" },
  { domain: "thelocal.com", name: "The Local", region: "EU" },
  { domain: "yle.fi", name: "YLE News", region: "FI", feed_url: "https://feeds.yle.fi/uutiset/v1/recent.rss?publisherIds=YLE_UUTISET" },
  { domain: "svt.se", name: "SVT Nyheter", region: "SE" },
  { domain: "nrk.no", name: "NRK", region: "NO" },
  { domain: "theherald.co.uk", name: "The Herald", region: "UK", feed_url: "https://www.heraldscotland.com/news/rss/" },
  { domain: "heraldscotland.com", name: "Herald Scotland", region: "UK", feed_url: "https://www.heraldscotland.com/news/rss/" },
  { domain: "nytimes.com", name: "New York Times", region: "US", feed_url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { domain: "washingtonpost.com", name: "Washington Post", region: "US" },
  { domain: "apnews.com", name: "AP News", region: "US", feed_url: "https://rsshub.app/apnews/topics/apf-topnews" },
  { domain: "cnn.com", name: "CNN", region: "US", feed_url: "http://rss.cnn.com/rss/edition_world.rss" },
  { domain: "bloomberg.com", name: "Bloomberg", region: "US" },
  { domain: "wsj.com", name: "Wall Street Journal", region: "US" },
  { domain: "japantimes.co.jp", name: "Japan Times", region: "JP", feed_url: "https://www.japantimes.co.jp/feed/" },
  { domain: "nhk.or.jp", name: "NHK World", region: "JP", feed_url: "https://www3.nhk.or.jp/rss/news/cat0.xml" },
  { domain: "asia.nikkei.com", name: "Nikkei Asia", region: "JP" },
  { domain: "abc.net.au", name: "ABC News AU", region: "AU", feed_url: "https://www.abc.net.au/news/feed/2942460/rss.xml" },
  { domain: "smh.com.au", name: "Sydney Morning Herald", region: "AU", feed_url: "https://www.smh.com.au/rss/feed.xml" },
  { domain: "theaustralian.com.au", name: "The Australian", region: "AU" },
  { domain: "nzherald.co.nz", name: "NZ Herald", region: "NZ", feed_url: "https://www.nzherald.co.nz/arc/outboundfeeds/rss/curate/78IFnsdMZOGLDhGMC3Enqg/?outputType=xml" },
  { domain: "stuff.co.nz", name: "Stuff NZ", region: "NZ", feed_url: "https://www.stuff.co.nz/rss" },
  { domain: "rnz.co.nz", name: "RNZ", region: "NZ", feed_url: "https://www.rnz.co.nz/rss/national.xml" },
];

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MediaPulse/1.0 BenchmarkDiscover)" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&nbsp;/gi, " ");
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

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "oc", "ref", "fbclid", "gclid"].forEach(p => parsed.searchParams.delete(p));
    parsed.hash = "";
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch { return url; }
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
  } catch { }
  return null;
}

function extractTitleFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
  } catch { return url; }
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
    .replace(/\s+/g, " ").trim();
}

function extractPublishedAtFromHtml(html: string): string | null {
  const metaPatterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+name=["']parsely-pub-date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const p of metaPatterns) {
    const match = html.match(p);
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

function detectLanguage(html: string): string | null {
  const m = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  return m ? m[1].split("-")[0].toLowerCase() : null;
}

interface SourceLog {
  domain: string;
  name: string;
  scanned: boolean;
  candidates: number;
  matched: number;
  inserted: number;
  skipped: number;
  failed: string[];
  methods_tried: string[];
  methods_succeeded: string[];
}

interface Candidate {
  title: string;
  url: string;
  snippet: string;
  published_at: string | null;
  source_domain: string;
  source_name: string;
  matched_keywords?: string[];
  matched_via?: string;
  discovery_method?: string;
  language?: string | null;
}

function parseRSSItems(xml: string, domain: string, name: string): Candidate[] {
  const items: Candidate[] = [];
  const nd = normalizeDomain(domain);
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getXmlTag(c, "title");
    const link = getXmlTag(c, "link") || getXmlTag(c, "guid");
    const desc = stripHtml(getXmlTag(c, "description")).slice(0, 500);
    const pubDate = getXmlTag(c, "pubDate") || getXmlTag(c, "dc:date");
    if (title && link) items.push({ title: stripHtml(title), url: normalizeUrl(link), snippet: desc, published_at: parseDateValue(pubDate) || extractDateFromUrl(link), source_domain: nd, source_name: name });
  }
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((m = entryRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getXmlTag(c, "title");
    const linkMatch = c.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : getXmlTag(c, "link");
    const summary = stripHtml(getXmlTag(c, "summary") || getXmlTag(c, "content")).slice(0, 500);
    const updated = getXmlTag(c, "updated") || getXmlTag(c, "published");
    if (title && link) items.push({ title: stripHtml(title), url: normalizeUrl(link), snippet: summary, published_at: parseDateValue(updated) || extractDateFromUrl(link), source_domain: nd, source_name: name });
  }
  return items;
}

function parseSitemapItems(xml: string, domain: string, name: string): Candidate[] {
  const items: Candidate[] = [];
  const re = /<url>([\s\S]*?)<\/url>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < 120) {
    const url = getXmlTag(m[1], "loc");
    if (!url) continue;
    const title = stripHtml(getXmlTag(m[1], "news:title") || extractTitleFromUrl(url)).slice(0, 220);
    const pubDate = getXmlTag(m[1], "news:publication_date") || getXmlTag(m[1], "lastmod");
    items.push({
      title, url: normalizeUrl(url), snippet: "",
      published_at: parseDateValue(pubDate) || extractDateFromUrl(url),
      source_domain: normalizeDomain(domain), source_name: name,
    });
  }
  return items;
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

function extractListingPageLinks(html: string, domain: string, name: string): Candidate[] {
  const items: Candidate[] = [];
  const linkRe = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const nd = normalizeDomain(domain);
  while ((m = linkRe.exec(html)) !== null && items.length < 80) {
    const href = m[1];
    const text = stripHtml(m[2]).trim();
    try {
      const u = new URL(href);
      if (normalizeDomain(u.hostname) !== nd) continue;
      const path = u.pathname.toLowerCase();
      const last = path.split("/").filter(Boolean).pop() || "";
      const isArticle = /\/\d{4}\/\d{2}\//.test(path) || /\d{5,}/.test(last) || last.split(/[-_]+/).length >= 4;
      if (!isArticle) continue;
      if (text.length < 10) continue;
      items.push({
        title: text.slice(0, 220), url: normalizeUrl(href), snippet: "",
        published_at: extractDateFromUrl(href),
        source_domain: nd, source_name: name,
      });
    } catch { }
  }
  return items;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const batchOffset = Number(body.offset ?? 0);
    const batchLimit = Math.min(Number(body.limit ?? 2), 2);
    const bodyScanBudget = Math.min(Number(body.body_scan_budget ?? 12), 20);

    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (!activeKeywords.length) {
      return new Response(JSON.stringify({ discovered: 0, message: "No active keywords", logs: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await supabase.from("settings").select("company_name").limit(1).maybeSingle();
    const expandedTermMap = new Map<string, string>();
    for (const kw of activeKeywords) {
      for (const et of ((kw as any).expanded_terms || [])) expandedTermMap.set(et.toLowerCase(), kw.text);
    }
    const searchTerms = [
      ...activeKeywords.map((k: any) => k.text),
      ...Array.from(expandedTermMap.keys()),
      ...(settings?.company_name && settings.company_name !== "My Company" ? [settings.company_name] : []),
    ].filter(Boolean);

    function matchKeywords(text: string): string[] {
      const n = normalizeText(text);
      const matched = new Set<string>();
      for (const term of searchTerms) {
        if (n.includes(normalizeText(term))) {
          matched.add(expandedTermMap.get(term.toLowerCase()) || term);
        }
      }
      return Array.from(matched);
    }

    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls || []).map((a: any) => normalizeUrl(a.url)));

    const sourceBatch = BENCHMARK_SOURCES.slice(batchOffset, batchOffset + batchLimit);
    const hasMore = batchOffset + batchLimit < BENCHMARK_SOURCES.length;

    console.log(`=== BENCHMARK DISCOVER: sources ${batchOffset}–${batchOffset + sourceBatch.length - 1} of ${BENCHMARK_SOURCES.length} ===`);

    const sourceLogs: SourceLog[] = [];
    let totalInserted = 0;

    for (const src of sourceBatch) {
      const log: SourceLog = {
        domain: src.domain, name: src.name, scanned: true,
        candidates: 0, matched: 0, inserted: 0, skipped: 0,
        failed: [], methods_tried: [], methods_succeeded: [],
      };

      const allCandidates: Candidate[] = [];
      const domain = normalizeDomain(src.domain);

      if (src.feed_url) {
        log.methods_tried.push("feed");
        try {
          const resp = await fetchWithTimeout(src.feed_url, 15000);
          if (resp.ok) {
            const xml = await resp.text();
            const items = parseRSSItems(xml, domain, src.name);
            allCandidates.push(...items.map(i => ({ ...i, discovery_method: "feed" })));
            log.methods_succeeded.push(`feed(${items.length})`);
          } else {
            log.failed.push(`feed: HTTP ${resp.status}`);
          }
        } catch (e: any) {
          log.failed.push(`feed: ${e.message?.slice(0, 60) || "error"}`);
        }
      }

      const sitemapUrls: string[] = [];
      log.methods_tried.push("robots.txt");
      try {
        const resp = await fetchWithTimeout(`https://${domain}/robots.txt`, 8000);
        if (resp.ok) {
          const txt = await resp.text();
          for (const line of txt.split(/\r?\n/)) {
            const match = line.match(/^Sitemap:\s*(.+)$/i);
            if (match?.[1]) sitemapUrls.push(match[1].trim());
          }
          log.methods_succeeded.push(`robots.txt(${sitemapUrls.length} sitemaps)`);
        } else {
          log.failed.push(`robots.txt: HTTP ${resp.status}`);
        }
      } catch (e: any) {
        log.failed.push(`robots.txt: ${e.message?.slice(0, 60) || "error"}`);
      }

      if (!sitemapUrls.some(u => u.includes("sitemap.xml"))) {
        sitemapUrls.push(`https://${domain}/sitemap.xml`);
      }

      log.methods_tried.push("news-sitemap.xml");
      if (!sitemapUrls.some(u => u.includes("news-sitemap"))) {
        sitemapUrls.push(`https://${domain}/news-sitemap.xml`);
      }

      log.methods_tried.push("sitemap_index");
      const MAX_CHILD_SITEMAPS = 3;
      for (const smUrl of sitemapUrls.slice(0, 5)) {
        try {
          const resp = await fetchWithTimeout(smUrl, 15000);
          if (!resp.ok) { log.failed.push(`sitemap ${smUrl.split("/").pop()}: HTTP ${resp.status}`); continue; }
          const xml = await resp.text();

          if (/<sitemapindex/i.test(xml)) {
            const children = parseSitemapIndex(xml).slice(-MAX_CHILD_SITEMAPS);
            log.methods_succeeded.push(`sitemap_index(${children.length} children)`);
            for (const childUrl of children) {
              try {
                const cResp = await fetchWithTimeout(childUrl, 15000);
                if (!cResp.ok) continue;
                const cXml = await cResp.text();
                const items = parseSitemapItems(cXml, domain, src.name);
                allCandidates.push(...items.map(i => ({ ...i, discovery_method: "sitemap" })));
              } catch { }
            }
          } else if (/<urlset/i.test(xml)) {
            const items = parseSitemapItems(xml, domain, src.name);
            allCandidates.push(...items.map(i => ({ ...i, discovery_method: "sitemap" })));
            log.methods_succeeded.push(`sitemap(${items.length})`);
          }
        } catch (e: any) {
          log.failed.push(`sitemap: ${e.message?.slice(0, 60) || "error"}`);
        }
      }

      log.methods_tried.push("listing_page");
      try {
        const resp = await fetchWithTimeout(`https://${domain}`, 20000);
        if (resp.ok) {
          const html = await resp.text();
          const items = extractListingPageLinks(html, domain, src.name);
          allCandidates.push(...items.map(i => ({ ...i, discovery_method: "listing_page" })));
          log.methods_succeeded.push(`listing_page(${items.length})`);
        } else {
          log.failed.push(`listing_page: HTTP ${resp.status}`);
        }
      } catch (e: any) {
        log.failed.push(`listing_page: ${e.message?.slice(0, 60) || "error"}`);
      }

      log.methods_tried.push("direct_paths");
      const directPaths = ["/news", "/latest", "/world", "/business"];
      let directCount = 0;
      for (const path of directPaths) {
        try {
          const resp = await fetchWithTimeout(`https://${domain}${path}`, 12000);
          if (resp.ok) {
            const html = await resp.text();
            const items = extractListingPageLinks(html, domain, src.name);
            allCandidates.push(...items.map(i => ({ ...i, discovery_method: "direct_path" })));
            directCount += items.length;
          }
        } catch { }
      }
      if (directCount > 0) log.methods_succeeded.push(`direct_paths(${directCount})`);

      if (firecrawlApiKey) {
        log.methods_tried.push("firecrawl_site_search");
        const primaryKeywords = activeKeywords.map((k: any) => k.text).slice(0, 5);
        let fcCount = 0;
        for (const kw of primaryKeywords) {
          try {
            const query = `site:${domain} "${kw}"`;
            const resp = await fetch("https://api.firecrawl.dev/v1/search", {
              method: "POST",
              headers: { "Authorization": `Bearer ${firecrawlApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ query, limit: 5 }),
            });
            if (resp.ok) {
              const data = await resp.json();
              const results = data.data || [];
              for (const r of results) {
                if (r.url) {
                  const fcPubDate = parseDateValue(r.metadata?.ogArticlePublishedTime || r.metadata?.["article:published_time"] || r.metadata?.publishedTime || r.publishedDate || r.metadata?.publishedDate)
                    || extractDateFromUrl(r.url);
                  allCandidates.push({
                    title: r.title || r.metadata?.title || extractTitleFromUrl(r.url),
                    url: normalizeUrl(r.url),
                    snippet: r.description || r.metadata?.description || "",
                    published_at: fcPubDate,
                    source_domain: domain,
                    source_name: src.name,
                    discovery_method: "firecrawl_search",
                  });
                  fcCount++;
                }
              }
            }
          } catch { }
        }
        if (fcCount > 0) log.methods_succeeded.push(`firecrawl(${fcCount})`);
      }

      const seenUrls = new Set<string>();
      const uniqueCandidates = allCandidates.filter(c => {
        const n = normalizeUrl(c.url);
        if (seenUrls.has(n)) return false;
        seenUrls.add(n);
        return true;
      });

      log.candidates = uniqueCandidates.length;

      const matched: Candidate[] = [];
      const unmatched: Candidate[] = [];

      for (const c of uniqueCandidates) {
        if (existingUrlSet.has(normalizeUrl(c.url))) { log.skipped++; continue; }
        const kws = matchKeywords(`${c.title} ${c.snippet} ${c.url}`);
        if (kws.length > 0) {
          c.matched_keywords = kws;
          c.matched_via = "title_snippet_url";
          matched.push(c);
        } else {
          unmatched.push(c);
        }
      }

      const toBodyScan = unmatched.slice(0, bodyScanBudget);
      for (const c of toBodyScan) {
        try {
          const resp = await fetchWithTimeout(c.url, 20000);
          if (!resp.ok) continue;
          const ct = resp.headers.get("content-type") || "";
          if (!ct.includes("text/html") && !ct.includes("xhtml")) { await resp.text(); continue; }
          const html = await resp.text();
          const bodyText = extractReadableText(html).slice(0, 15000);
          const kws = matchKeywords(bodyText);
          if (kws.length > 0) {
            c.matched_keywords = kws;
            c.matched_via = "body_scan";
            c.language = detectLanguage(html);
            c.published_at = c.published_at || extractPublishedAtFromHtml(html) || extractDateFromUrl(c.url);
            matched.push(c);
          }
        } catch { }
      }

      log.matched = matched.length;

      // Extract published_at from HTML for articles missing dates — use Firecrawl as fallback
      const needDate = matched
        .filter(c => !c.published_at)
        .sort((a, b) => Number(b.source_domain === "reuters.com") - Number(a.source_domain === "reuters.com"));
      if (needDate.length > 0) {
        const DATE_BATCH = 3;
        for (let d = 0; d < Math.min(needDate.length, 20); d += DATE_BATCH) {
          await Promise.allSettled(needDate.slice(d, d + DATE_BATCH).map(async (c) => {
            // Try direct fetch first
            try {
              const resp = await fetchWithTimeout(c.url, 10000);
              if (resp.ok) {
                const ct = resp.headers.get("content-type") || "";
                if (ct.includes("text/html") || ct.includes("xhtml")) {
                  const html = await resp.text();
                  c.published_at = extractPublishedAtFromHtml(html) || extractDateFromUrl(c.url);
                  if (!c.language) c.language = detectLanguage(html);
                  if (c.published_at) return;
                }
              }
            } catch { }
            // Fallback: Firecrawl scrape
            if (firecrawlApiKey) {
              try {
                const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${firecrawlApiKey}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ url: c.url, formats: ["html"], onlyMainContent: false, timeout: 10000 }),
                });
                if (resp.ok) {
                  const data = await resp.json();
                  const html = data.data?.html || "";
                  const meta = data.data?.metadata || {};
                  c.published_at = parseDateValue(meta.ogArticlePublishedTime || meta["article:published_time"] || meta.publishedTime)
                    || extractPublishedAtFromHtml(html) || extractDateFromUrl(c.url);
                  if (!c.language) c.language = meta.language?.split("-")[0] || detectLanguage(html);
                }
              } catch { }
            }
          }));
        }
      }

      if (matched.length > 0) {
        const { data: sources } = await supabase.from("sources").select("id,domain").eq("domain", domain).limit(1);
        const sourceId = sources?.[0]?.id || null;

        const BATCH_SIZE = 10;
        for (let b = 0; b < matched.length; b += BATCH_SIZE) {
          const batch = matched.slice(b, b + BATCH_SIZE);
          const toInsert = batch.map(a => ({
            title: stripHtml(a.title).slice(0, 300),
            snippet: stripHtml(a.snippet || "").slice(0, 500),
            url: normalizeUrl(a.url),
            source_id: sourceId,
            source_name: a.source_name || src.name,
            source_domain: domain,
            published_at: a.published_at || new Date().toISOString(),
            fetched_at: new Date().toISOString(),
            matched_keywords: a.matched_keywords || [],
            language: a.language || null,
            sentiment: "neutral",
            sentiment_score: 0.5,
            discovery_method: a.discovery_method || "benchmark",
            matched_via: a.matched_via || "title_snippet_url",
          }));

          try {
            const prompt = toInsert.map((it, i) => `[${i}] Title: ${it.title}\nSnippet: ${it.snippet}`).join("\n\n");
            const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                tools: [{ type: "function", function: { name: "classify_sentiments", description: "Classify sentiment", parameters: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "number" }, sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }, score: { type: "number" } }, required: ["index", "sentiment", "score"] } } }, required: ["results"] } } }],
                tool_choice: { type: "function", function: { name: "classify_sentiments" } },
                messages: [{ role: "system", content: "Classify the sentiment of each news article." }, { role: "user", content: prompt }],
              }),
            });
            if (r.ok) {
              const d = JSON.parse(await r.text());
              const tc = d.choices?.[0]?.message?.tool_calls?.[0];
              if (tc?.function?.arguments) {
                const p = JSON.parse(tc.function.arguments);
                const res = p.results || [];
                toInsert.forEach((a, i) => {
                  const x = res.find((r: any) => r.index === i);
                  if (x) { a.sentiment = x.sentiment; a.sentiment_score = x.score; }
                });
              }
            }
          } catch { }

          const { data: ins, error } = await supabase.from("articles").upsert(toInsert, { onConflict: "url", ignoreDuplicates: true }).select("id");
          if (error) console.error(`Benchmark insert error for ${src.name}:`, error);
          const count = ins?.length || 0;
          log.inserted += count;
          totalInserted += count;

          for (const a of toInsert) existingUrlSet.add(normalizeUrl(a.url));
        }

        for (const a of matched) {
          for (const kw of (a.matched_keywords || [])) {
            const k = activeKeywords.find((x: any) => x.text === kw);
            if (k) {
              await supabase.from("keywords").update({ match_count: ((k as any).match_count || 0) + 1 }).eq("id", (k as any).id);
            }
          }
        }
      }

      console.log(`[BENCHMARK] ${src.name} (${domain}): candidates=${log.candidates} matched=${log.matched} inserted=${log.inserted} skipped=${log.skipped} methods=${log.methods_succeeded.join(",")} failures=${log.failed.join(",") || "none"}`);
      sourceLogs.push(log);
    }

    for (const src of sourceBatch) {
      await supabase.from("approved_domains").upsert({
        domain: src.domain, name: src.name, approval_status: "approved",
        active: true, priority: 100, region: src.region,
        feed_url: src.feed_url || null,
      }, { onConflict: "domain" });
    }

    return new Response(JSON.stringify({
      discovered: totalInserted,
      stage: "benchmark",
      offset: batchOffset,
      limit: batchLimit,
      hasMore,
      totalBenchmark: BENCHMARK_SOURCES.length,
      logs: sourceLogs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("benchmark-discover error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
