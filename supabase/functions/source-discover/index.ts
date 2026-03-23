import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface DiscoveryResult {
  source_type: "rss" | "atom" | "sitemap" | "news_sitemap" | "html";
  feed_url: string;
  domain: string;
  preview_articles: { title: string; url: string; date?: string }[];
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "MediaPulse/1.0 SourceDiscovery" },
    });
    return resp;
  } finally {
    clearTimeout(timeout);
  }
}

function extractFeeds(html: string, baseUrl: string): { type: "rss" | "atom"; url: string }[] {
  const feeds: { type: "rss" | "atom"; url: string }[] = [];
  const linkRegex = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    const typeMatch = tag.match(/type=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (typeMatch && hrefMatch) {
      const mimeType = typeMatch[1].toLowerCase();
      const href = hrefMatch[1];
      const fullUrl = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
      if (mimeType.includes("rss") || mimeType.includes("xml")) {
        feeds.push({ type: "rss", url: fullUrl });
      } else if (mimeType.includes("atom")) {
        feeds.push({ type: "atom", url: fullUrl });
      }
    }
  }
  return feeds;
}

function parseRSSPreview(xml: string): { title: string; url: string; date?: string }[] {
  const items: { title: string; url: string; date?: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
    const content = match[1];
    const getTag = (tag: string) => {
      const m = content.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "si"));
      return m ? m[1].trim() : "";
    };
    const title = getTag("title");
    const link = getTag("link") || getTag("guid");
    const pubDate = getTag("pubDate") || getTag("dc:date") || getTag("published");
    if (title && link) items.push({ title, url: link, date: pubDate || undefined });
  }
  // Also try Atom entries
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null && items.length < 5) {
    const content = match[1];
    const getTag = (tag: string) => {
      const m = content.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "si"));
      return m ? m[1].trim() : "";
    };
    const title = getTag("title");
    const linkMatch = content.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : getTag("link");
    const updated = getTag("updated") || getTag("published");
    if (title && link) items.push({ title, url: link, date: updated || undefined });
  }
  return items;
}

function parseSitemapPreview(xml: string): { title: string; url: string; date?: string }[] {
  const items: { title: string; url: string; date?: string }[] = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  let match;
  while ((match = urlRegex.exec(xml)) !== null && items.length < 5) {
    const content = match[1];
    const locMatch = content.match(/<loc>(.*?)<\/loc>/i);
    const lastmodMatch = content.match(/<lastmod>(.*?)<\/lastmod>/i);
    const newsTitle = content.match(/<news:title>(.*?)<\/news:title>/i);
    if (locMatch) {
      items.push({
        title: newsTitle ? newsTitle[1] : locMatch[1].split("/").pop() || locMatch[1],
        url: locMatch[1],
        date: lastmodMatch ? lastmodMatch[1] : undefined,
      });
    }
  }
  return items;
}

function parseHTMLPreview(html: string, baseUrl: string): { title: string; url: string; date?: string }[] {
  const items: { title: string; url: string; date?: string }[] = [];
  // Extract article-like links from headings or article tags
  const patterns = [
    /<article[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<h[1-3][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ];
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(html)) !== null && items.length < 5) {
      const href = match[1];
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      if (text.length > 10 && !href.startsWith("#") && !href.startsWith("javascript")) {
        const fullUrl = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
        items.push({ title: text.slice(0, 120), url: fullUrl });
      }
    }
  }
  return items;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { input } = await req.json();
    if (!input || typeof input !== "string") {
      return new Response(JSON.stringify({ error: "Input URL or domain required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let url = input.trim();
    // If it looks like a domain, prepend https://
    if (!url.startsWith("http")) url = `https://${url}`;
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;
    const baseUrl = `${parsedUrl.protocol}//${domain}`;

    const results: DiscoveryResult[] = [];

    // 1. Try fetching the input directly (might be an RSS/sitemap URL)
    try {
      const resp = await fetchWithTimeout(url);
      if (resp.ok) {
        const text = await resp.text();
        const contentType = resp.headers.get("content-type") || "";

        // Check if it's XML/RSS/Atom
        if (contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom") || text.trimStart().startsWith("<?xml")) {
          if (text.includes("<feed") || text.includes("<entry>")) {
            const preview = parseRSSPreview(text);
            if (preview.length > 0) {
              results.push({ source_type: "atom", feed_url: url, domain, preview_articles: preview });
            }
          } else if (text.includes("<rss") || text.includes("<channel>")) {
            const preview = parseRSSPreview(text);
            if (preview.length > 0) {
              results.push({ source_type: "rss", feed_url: url, domain, preview_articles: preview });
            }
          } else if (text.includes("<sitemapindex") || text.includes("<urlset")) {
            const isNews = text.includes("<news:news") || url.includes("news");
            const preview = parseSitemapPreview(text);
            results.push({
              source_type: isNews ? "news_sitemap" : "sitemap",
              feed_url: url, domain, preview_articles: preview,
            });
          }
        }

        // If it's HTML, try autodiscovery
        if (results.length === 0 && (contentType.includes("html") || text.includes("<html"))) {
          const feeds = extractFeeds(text, baseUrl);
          for (const feed of feeds.slice(0, 2)) {
            try {
              const feedResp = await fetchWithTimeout(feed.url);
              if (feedResp.ok) {
                const feedText = await feedResp.text();
                const preview = parseRSSPreview(feedText);
                if (preview.length > 0) {
                  results.push({ source_type: feed.type, feed_url: feed.url, domain, preview_articles: preview });
                }
              }
            } catch { /* skip */ }
          }

          // 2. Try /sitemap.xml
          if (results.length === 0) {
            try {
              const smResp = await fetchWithTimeout(`${baseUrl}/sitemap.xml`);
              if (smResp.ok) {
                const smText = await smResp.text();
                if (smText.includes("<urlset") || smText.includes("<sitemapindex")) {
                  const isNews = smText.includes("<news:news");
                  const preview = parseSitemapPreview(smText);
                  if (preview.length > 0) {
                    results.push({
                      source_type: isNews ? "news_sitemap" : "sitemap",
                      feed_url: `${baseUrl}/sitemap.xml`, domain, preview_articles: preview,
                    });
                  }
                }
              }
            } catch { /* skip */ }
          }

          // 3. Try /news-sitemap.xml
          if (results.length === 0) {
            try {
              const nsResp = await fetchWithTimeout(`${baseUrl}/news-sitemap.xml`);
              if (nsResp.ok) {
                const nsText = await nsResp.text();
                if (nsText.includes("<urlset")) {
                  const preview = parseSitemapPreview(nsText);
                  if (preview.length > 0) {
                    results.push({
                      source_type: "news_sitemap",
                      feed_url: `${baseUrl}/news-sitemap.xml`, domain, preview_articles: preview,
                    });
                  }
                }
              }
            } catch { /* skip */ }
          }

          // 4. Fallback: HTML scraping
          if (results.length === 0) {
            const preview = parseHTMLPreview(text, baseUrl);
            results.push({ source_type: "html", feed_url: baseUrl, domain, preview_articles: preview });
          }
        }
      }
    } catch (e) {
      console.error("Discovery fetch error:", e);
    }

    // If nothing worked at all, return html fallback
    if (results.length === 0) {
      results.push({ source_type: "html", feed_url: baseUrl, domain, preview_articles: [] });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("source-discover error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
