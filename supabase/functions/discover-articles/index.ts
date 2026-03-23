import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface DiscoveredArticle {
  title: string;
  snippet: string;
  url: string;
  published_at: string;
  source_domain: string;
  source_name: string;
  matched_keywords: string[];
}

interface RSSItem {
  title: string;
  url: string;
  snippet: string;
  published_at: string;
  source_domain: string;
  source_name: string;
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MediaPulse/1.0)" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text: string): string {
  return stripHtml(text)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "oc"].forEach((param) => {
      parsed.searchParams.delete(param);
    });
    parsed.hash = "";
    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function buildOriginsForDomain(domain: string): string[] {
  const cleanDomain = normalizeDomain(domain);
  return uniqueStrings([
    `https://${cleanDomain}`,
    cleanDomain.startsWith("www.") ? undefined : `https://www.${cleanDomain}`,
  ]);
}

function extractTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
    return decodeURIComponent(lastSegment)
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return url;
  }
}

function looksLikeArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const lastSegment = path.split("/").filter(Boolean).pop() || "";
    return /\/\d{4}\/\d{2}\/\d{2}\//.test(path)
      || /\d{5,}/.test(lastSegment)
      || lastSegment.split(/[-_]+/).length >= 4;
  } catch {
    return false;
  }
}

function getXmlTag(content: string, tag: string): string {
  const match = content.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\/${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

async function fetchTextDocument(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(url, timeoutMs);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(url, 8000);
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/xml") && !contentType.includes("application/xhtml")) {
      await resp.text();
      return null;
    }
    const html = await resp.text();
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : html;
    const cleaned = bodyHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/&#\d+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.slice(0, 12000);
  } catch {
    return null;
  }
}

function buildGoogleNewsUrl(keyword: string, lang = "en"): string {
  const q = encodeURIComponent(keyword);
  return `https://news.google.com/rss/search?q=${q}&hl=${lang}&gl=US&ceid=US:${lang}`;
}

function parseGoogleNewsRSS(xml: string, keyword: string): DiscoveredArticle[] {
  const articles: DiscoveredArticle[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const c = match[1];
    const title = getXmlTag(c, "title");
    const gnLink = getXmlTag(c, "link");
    const description = stripHtml(getXmlTag(c, "description")).slice(0, 500);
    const pubDate = getXmlTag(c, "pubDate");
    const sourceMatch = c.match(/<source[^>]+url=["']([^"']+)["'][^>]*>(.*?)<\/source>/i);

    if (title && gnLink) {
      let domain = "";
      try {
        domain = normalizeDomain(sourceMatch ? sourceMatch[1] : gnLink);
      } catch {
        domain = "";
      }

      articles.push({
        title,
        snippet: description,
        url: gnLink,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source_domain: domain,
        source_name: sourceMatch ? stripHtml(sourceMatch[2]) : domain,
        matched_keywords: [keyword],
      });
    }
  }
  return articles;
}

function parseRSSItems(xml: string, domain: string, sourceName: string): RSSItem[] {
  const items: RSSItem[] = [];
  const normalizedDomain = normalizeDomain(domain);

  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const c = match[1];
    const title = getXmlTag(c, "title");
    const link = getXmlTag(c, "link") || getXmlTag(c, "guid");
    const description = stripHtml(getXmlTag(c, "description")).slice(0, 500);
    const pubDate = getXmlTag(c, "pubDate") || getXmlTag(c, "dc:date");

    if (title && link) {
      items.push({
        title,
        url: link,
        snippet: description,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source_domain: normalizedDomain,
        source_name: sourceName,
      });
    }
  }

  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const c = match[1];
    const title = getXmlTag(c, "title");
    const linkMatch = c.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : getXmlTag(c, "link");
    const summary = stripHtml(getXmlTag(c, "summary") || getXmlTag(c, "content")).slice(0, 500);
    const updated = getXmlTag(c, "updated") || getXmlTag(c, "published");

    if (title && link) {
      items.push({
        title,
        url: link,
        snippet: summary,
        published_at: updated ? new Date(updated).toISOString() : new Date().toISOString(),
        source_domain: normalizedDomain,
        source_name: sourceName,
      });
    }
  }
  return items;
}

function parseSitemapIndex(xml: string): string[] {
  const sitemaps: string[] = [];
  const sitemapRegex = /<sitemap>([\s\S]*?)<\/sitemap>/gi;
  let match;
  while ((match = sitemapRegex.exec(xml)) !== null) {
    const loc = getXmlTag(match[1], "loc");
    if (loc) sitemaps.push(loc);
  }
  return uniqueStrings(sitemaps);
}

function parseSitemapItems(xml: string, domain: string, sourceName: string): RSSItem[] {
  const items: RSSItem[] = [];
  const normalizedDomain = normalizeDomain(domain);
  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  let match;

  while ((match = urlRegex.exec(xml)) !== null) {
    const content = match[1];
    const url = getXmlTag(content, "loc");
    if (!url) continue;

    const title = stripHtml(getXmlTag(content, "news:title") || extractTitleFromUrl(url)).slice(0, 220);
    const snippet = stripHtml(getXmlTag(content, "news:keywords") || getXmlTag(content, "image:title")).slice(0, 500);
    const publishedAt = getXmlTag(content, "news:publication_date") || getXmlTag(content, "lastmod");

    items.push({
      title,
      url,
      snippet,
      published_at: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
      source_domain: normalizedDomain,
      source_name: sourceName,
    });
  }

  return items;
}

function parseHTMLArticleLinks(html: string, baseUrl: string, domain: string, sourceName: string, limit = 25): RSSItem[] {
  const items: RSSItem[] = [];
  const normalizedDomain = normalizeDomain(domain);
  const patterns = [
    /<article[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<h[1-4][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ];
  const seen = new Set<string>();

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(html)) !== null && items.length < limit) {
      const href = match[1];
      const text = stripHtml(match[2]);
      if (!href || !text || text.length < 12 || href.startsWith("#") || href.startsWith("javascript:")) continue;

      const fullUrl = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
      const normalizedUrl = normalizeUrl(fullUrl);
      if (seen.has(normalizedUrl) || !looksLikeArticleUrl(fullUrl)) continue;
      seen.add(normalizedUrl);

      items.push({
        title: text.slice(0, 220),
        url: fullUrl,
        snippet: "",
        published_at: new Date().toISOString(),
        source_domain: normalizedDomain,
        source_name: sourceName,
      });
    }
  }

  return items;
}

function matchKeywords(text: string, keywords: string[]): string[] {
  const normalized = normalizeText(text);
  return keywords.filter((keyword) => normalized.includes(normalizeText(keyword)));
}

async function fetchRobotsSitemaps(domain: string): Promise<string[]> {
  const sitemapUrls: string[] = [];
  const origins = buildOriginsForDomain(domain);

  for (const origin of origins) {
    try {
      const text = await fetchTextDocument(`${origin}/robots.txt`, 8000);
      if (!text) continue;
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^Sitemap:\s*(.+)$/i);
        if (match?.[1]) sitemapUrls.push(match[1].trim());
      }
    } catch {
      continue;
    }
  }

  return uniqueStrings(sitemapUrls);
}

function buildSitemapGuessUrls(domain: string): string[] {
  const origins = buildOriginsForDomain(domain);
  return uniqueStrings(origins.flatMap((origin) => [
    `${origin}/sitemap.xml`,
    `${origin}/news-sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ]));
}

async function collectApprovedDomainCandidates(
  approvedDomains: Array<{ domain: string; name: string; sitemap_url?: string | null }>,
  keywords: string[],
  existingUrlSet: Set<string>,
  maxDomains = 8,
  childSitemapLimit = 3,
): Promise<{ matched: DiscoveredArticle[]; unmatched: RSSItem[] }> {
  const matched: DiscoveredArticle[] = [];
  const unmatched: RSSItem[] = [];
  const domainsToScan = approvedDomains.slice(0, maxDomains);
  const DOMAIN_CONCURRENCY = 2;

  for (let i = 0; i < domainsToScan.length; i += DOMAIN_CONCURRENCY) {
    const batch = domainsToScan.slice(i, i + DOMAIN_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (domainRow) => {
        const domain = normalizeDomain(domainRow.domain);
        const sourceName = domainRow.name || domain;
        const domainMatched: DiscoveredArticle[] = [];
        const domainUnmatched: RSSItem[] = [];
        const articleCandidates = new Map<string, RSSItem>();
        const listingPages = new Set<string>();

        const sitemapUrls = uniqueStrings([
          domainRow.sitemap_url,
          ...(await fetchRobotsSitemaps(domain)),
          ...buildSitemapGuessUrls(domain),
        ]).slice(0, 8);

        for (const sitemapUrl of sitemapUrls) {
          const sitemapText = await fetchTextDocument(sitemapUrl, 10000);
          if (!sitemapText) continue;

          const sitemapDocuments = /<sitemapindex/i.test(sitemapText)
            ? parseSitemapIndex(sitemapText).slice(-childSitemapLimit)
            : [sitemapUrl];

          const xmlDocuments = /<sitemapindex/i.test(sitemapText)
            ? await Promise.all(sitemapDocuments.map((url) => fetchTextDocument(url, 10000)))
            : [sitemapText];

          for (const xmlText of xmlDocuments) {
            if (!xmlText || !/<urlset/i.test(xmlText)) continue;
            const parsedItems = parseSitemapItems(xmlText, domain, sourceName).slice(-30);
            for (const item of parsedItems) {
              const normalizedItemUrl = normalizeUrl(item.url);
              if (existingUrlSet.has(normalizedItemUrl)) continue;
              if (looksLikeArticleUrl(item.url)) {
                articleCandidates.set(normalizedItemUrl, item);
              } else if (listingPages.size < 4) {
                listingPages.add(item.url);
              }
            }
          }
        }

        for (const listingUrl of Array.from(listingPages).slice(0, 2)) {
          const html = await fetchTextDocument(listingUrl, 10000);
          if (!html) continue;
          const linkedArticles = parseHTMLArticleLinks(html, listingUrl, domain, sourceName, 25);
          for (const item of linkedArticles) {
            const normalizedItemUrl = normalizeUrl(item.url);
            if (!existingUrlSet.has(normalizedItemUrl)) {
              articleCandidates.set(normalizedItemUrl, item);
            }
          }
        }

        for (const item of articleCandidates.values()) {
          const keywordMatches = matchKeywords(`${item.title} ${item.snippet} ${item.url}`, keywords);
          if (keywordMatches.length > 0) {
            domainMatched.push({ ...item, matched_keywords: keywordMatches });
          } else {
            domainUnmatched.push(item);
          }
        }

        return { matched: domainMatched, unmatched: domainUnmatched };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        matched.push(...result.value.matched);
        unmatched.push(...result.value.unmatched);
      }
    }

    if (i + DOMAIN_CONCURRENCY < domainsToScan.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return { matched, unmatched };
}

async function deepScanForKeywords(
  unmatchedItems: RSSItem[],
  keywords: string[],
  maxItems = 30,
): Promise<DiscoveredArticle[]> {
  const results: DiscoveredArticle[] = [];
  const toScan = unmatchedItems.slice(0, maxItems);
  const CONCURRENCY = 5;

  for (let i = 0; i < toScan.length; i += CONCURRENCY) {
    const batch = toScan.slice(i, i + CONCURRENCY);
    const fetched = await Promise.allSettled(
      batch.map(async (item) => {
        const bodyText = await fetchArticleText(item.url);
        if (!bodyText) return null;
        const matched = matchKeywords(bodyText, keywords);
        if (matched.length > 0) {
          return {
            ...item,
            matched_keywords: matched,
          } as DiscoveredArticle;
        }
        return null;
      })
    );
    for (const result of fetched) {
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
      }
    }
  }
  return results;
}

async function analyzeSentimentBatch(
  items: { title: string; snippet: string }[],
  apiKey: string
): Promise<{ sentiment: string; score: number }[]> {
  if (items.length === 0) return [];
  const prompt = items.map((item, i) => `[${i}] Title: ${item.title}\nSnippet: ${item.snippet}`).join("\n\n");
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        tools: [{
          type: "function",
          function: {
            name: "classify_sentiments",
            description: "Classify sentiment for each article",
            parameters: {
              type: "object",
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "number" },
                      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
                      score: { type: "number" },
                    },
                    required: ["index", "sentiment", "score"],
                  },
                },
              },
              required: ["results"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "classify_sentiments" } },
        messages: [
          { role: "system", content: "Classify the sentiment of each news article." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
    const text = await response.text();
    if (!text) return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
    const data = JSON.parse(text);
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      const results = parsed.results || [];
      return items.map((_, i) => {
        const result = results.find((x: any) => x.index === i);
        return result ? { sentiment: result.sentiment, score: result.score } : { sentiment: "neutral", score: 0.5 };
      });
    }
    return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
  } catch {
    return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const maxDomainFeeds = body.max_domains || 50;
    const deepScanLimit = body.deep_scan_limit || 30;

    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (activeKeywords.length === 0) {
      return new Response(JSON.stringify({ discovered: 0, message: "No active keywords configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await supabase.from("settings").select("company_name").limit(1).maybeSingle();
    const searchTerms = uniqueStrings([
      ...activeKeywords.map((keyword) => keyword.text),
      settings?.company_name && settings.company_name !== "My Company" ? settings.company_name : undefined,
    ]);

    const { data: sources } = await supabase.from("sources").select("id, rss_url, domain");
    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls || []).map((article) => normalizeUrl(article.url)));

    let allDiscovered: DiscoveredArticle[] = [];
    let allUnmatchedItems: RSSItem[] = [];

    console.log(`Searching Google News for ${searchTerms.length} keywords...`);
    for (const term of searchTerms) {
      try {
        const url = buildGoogleNewsUrl(term);
        const resp = await fetchWithTimeout(url, 15000);
        if (resp.ok) {
          const xml = await resp.text();
          const articles = parseGoogleNewsRSS(xml, term);
          console.log(`Google News "${term}": ${articles.length} articles`);
          allDiscovered.push(...articles);
        } else {
          console.warn(`Google News "${term}": HTTP ${resp.status}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Google News "${term}" error:`, error);
      }
    }

    const { data: domains } = await supabase
      .from("approved_domains")
      .select("*")
      .eq("active", true)
      .eq("approval_status", "approved")
      .order("priority", { ascending: false })
      .limit(maxDomainFeeds);

    const domainsWithFeeds = (domains || []).filter((domain) => domain.feed_url);
    if (domainsWithFeeds.length > 0) {
      console.log(`Searching ${domainsWithFeeds.length} approved domain feeds...`);
      const CONCURRENCY = 5;
      for (let i = 0; i < domainsWithFeeds.length; i += CONCURRENCY) {
        const batch = domainsWithFeeds.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (domain) => {
            try {
              const resp = await fetchWithTimeout(domain.feed_url, 10000);
              if (!resp.ok) return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] };
              const xml = await resp.text();
              const items = parseRSSItems(xml, domain.domain, domain.name);
              const matched: DiscoveredArticle[] = [];
              const unmatched: RSSItem[] = [];
              for (const item of items) {
                const keywordsMatched = matchKeywords(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
                if (keywordsMatched.length > 0) {
                  matched.push({ ...item, matched_keywords: keywordsMatched });
                } else {
                  unmatched.push(item);
                }
              }
              return { matched, unmatched };
            } catch {
              return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] };
            }
          })
        );
        for (const result of results) {
          if (result.status === "fulfilled") {
            allDiscovered.push(...result.value.matched);
            allUnmatchedItems.push(...result.value.unmatched);
          }
        }
        if (i + CONCURRENCY < domainsWithFeeds.length) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    }

    const { data: activeSources } = await supabase
      .from("sources")
      .select("*")
      .eq("active", true)
      .limit(100);

    if (activeSources && activeSources.length > 0) {
      console.log(`Searching ${activeSources.length} active source feeds...`);
      const CONCURRENCY = 5;
      for (let i = 0; i < activeSources.length; i += CONCURRENCY) {
        const batch = activeSources.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (source) => {
            try {
              const resp = await fetchWithTimeout(source.rss_url, 10000);
              if (!resp.ok) return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] };
              const xml = await resp.text();
              const domain = source.domain || normalizeDomain(new URL(source.rss_url).hostname);
              const items = parseRSSItems(xml, domain, source.name);
              const matched: DiscoveredArticle[] = [];
              const unmatched: RSSItem[] = [];
              for (const item of items) {
                const keywordsMatched = matchKeywords(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
                if (keywordsMatched.length > 0) {
                  matched.push({ ...item, matched_keywords: keywordsMatched });
                } else {
                  unmatched.push(item);
                }
              }
              return { matched, unmatched };
            } catch {
              return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] };
            }
          })
        );
        for (const result of results) {
          if (result.status === "fulfilled") {
            allDiscovered.push(...result.value.matched);
            allUnmatchedItems.push(...result.value.unmatched);
          }
        }
      }
    }

    // Sitemap scanning is handled by separate 'discover-sitemaps' function
    const unmatchedToScan = allUnmatchedItems.filter((item) => !existingUrlSet.has(normalizeUrl(item.url)));
    if (unmatchedToScan.length > 0) {
      console.log(`Deep scanning ${Math.min(unmatchedToScan.length, deepScanLimit)} of ${unmatchedToScan.length} unmatched articles for full-text keyword matches...`);
      const deepMatches = await deepScanForKeywords(unmatchedToScan, searchTerms, deepScanLimit);
      console.log(`Deep scan found ${deepMatches.length} additional articles with keyword matches in body text`);
      allDiscovered.push(...deepMatches);
    }

    console.log(`Total candidates before dedup: ${allDiscovered.length}`);

    const seen = new Set<string>();
    allDiscovered = allDiscovered.filter((article) => {
      const normalized = normalizeUrl(article.url);
      if (seen.has(normalized) || existingUrlSet.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    console.log(`After dedup: ${allDiscovered.length} new articles`);

    const newDomains = new Map<string, { name: string; count: number }>();
    const knownDomains = new Set([
      ...(sources || []).map((source) => source.domain).filter(Boolean).map((domain) => normalizeDomain(domain!)),
      ...(domains || []).map((domain) => normalizeDomain(domain.domain)),
    ]);

    for (const article of allDiscovered) {
      if (article.source_domain && !knownDomains.has(normalizeDomain(article.source_domain))) {
        const key = normalizeDomain(article.source_domain);
        const existing = newDomains.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          newDomains.set(key, { name: article.source_name, count: 1 });
        }
      }
    }

    if (newDomains.size > 0) {
      const candidates = Array.from(newDomains.entries()).map(([domain, info]) => ({
        domain,
        name: info.name || domain,
        approval_status: "pending",
        auto_discovered: true,
        active: false,
        priority: 30,
      }));

      const { data: existingDomains } = await supabase
        .from("approved_domains")
        .select("domain")
        .in("domain", candidates.map((candidate) => candidate.domain));
      const existingDomainSet = new Set((existingDomains || []).map((domain) => normalizeDomain(domain.domain)));
      const trulyNew = candidates.filter((candidate) => !existingDomainSet.has(normalizeDomain(candidate.domain)));

      if (trulyNew.length > 0) {
        await supabase.from("approved_domains").insert(trulyNew);
        console.log(`Auto-discovered ${trulyNew.length} new source domains`);
      }
    }

    let totalInserted = 0;
    const keywordMatchUpdates: Record<string, number> = {};
    const BATCH_SIZE = 10;

    for (let batchIndex = 0; batchIndex < allDiscovered.length; batchIndex += BATCH_SIZE) {
      const batch = allDiscovered.slice(batchIndex, batchIndex + BATCH_SIZE);

      const articlesToInsert = batch.map((article) => {
        for (const keywordText of article.matched_keywords) {
          const keyword = activeKeywords.find((entry) => entry.text === keywordText);
          if (keyword) keywordMatchUpdates[keyword.id] = (keywordMatchUpdates[keyword.id] || 0) + 1;
        }

        const matchedSource = sources?.find((source) =>
          normalizeDomain(source.domain || "") === normalizeDomain(article.source_domain)
          || (source.rss_url && normalizeDomain(new URL(source.rss_url).hostname) === normalizeDomain(article.source_domain))
        );

        return {
          title: article.title,
          snippet: article.snippet.slice(0, 500),
          url: article.url,
          source_id: matchedSource?.id || null,
          published_at: article.published_at,
          fetched_at: new Date().toISOString(),
          matched_keywords: article.matched_keywords,
          language: "en",
          sentiment: "neutral" as string,
          sentiment_score: 0.5,
        };
      });

      const sentiments = await analyzeSentimentBatch(
        articlesToInsert.map((article) => ({ title: article.title, snippet: article.snippet || "" })),
        lovableApiKey,
      );
      articlesToInsert.forEach((article, index) => {
        article.sentiment = sentiments[index].sentiment;
        article.sentiment_score = sentiments[index].score;
      });

      const { data: inserted, error: insertErr } = await supabase
        .from("articles")
        .upsert(articlesToInsert, { onConflict: "url", ignoreDuplicates: true })
        .select("id");

      if (insertErr) {
        console.error("Insert error:", insertErr);
      } else {
        totalInserted += inserted?.length || 0;
      }
    }

    for (const [keywordId, addCount] of Object.entries(keywordMatchUpdates)) {
      const keyword = activeKeywords.find((entry) => entry.id === keywordId);
      if (keyword) {
        await supabase.from("keywords").update({ match_count: keyword.match_count + addCount }).eq("id", keywordId);
      }
    }

    const summary = {
      discovered: totalInserted,
      totalCandidates: allDiscovered.length,
      deepScanned: Math.min(unmatchedToScan.length, deepScanLimit),
      newDomainsFound: newDomains.size,
      keywordsUsed: searchTerms,
      methods: ["google_news_rss", "approved_domain_feeds", "source_feeds", "approved_domain_sitemaps", "full_text_deep_scan"],
    };
    console.log("Discovery complete:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("discover-articles error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});