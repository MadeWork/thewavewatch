import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Helpers ──────────────────────────────────────────────

interface ParsedArticle {
  title: string;
  snippet: string;
  url: string;
  published_at: string;
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "MediaPulse/1.0 RSS Reader" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

// ── Parsers ──────────────────────────────────────────────

function parseRSSAtom(xml: string): ParsedArticle[] {
  const items: ParsedArticle[] = [];
  // RSS items
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const c = match[1];
    const getTag = (tag: string) => {
      const m = c.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "si"));
      return m ? m[1].trim() : "";
    };
    const title = getTag("title");
    const link = getTag("link") || getTag("guid");
    const description = getTag("description");
    const pubDate = getTag("pubDate") || getTag("dc:date") || getTag("published");
    if (title && link) {
      items.push({
        title,
        snippet: description.replace(/<[^>]+>/g, "").slice(0, 500),
        url: link,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      });
    }
  }
  // Atom entries
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const c = match[1];
    const getTag = (tag: string) => {
      const m = c.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "si"));
      return m ? m[1].trim() : "";
    };
    const title = getTag("title");
    const linkMatch = c.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : getTag("link");
    const summary = getTag("summary") || getTag("content");
    const updated = getTag("updated") || getTag("published");
    if (title && link) {
      items.push({
        title,
        snippet: summary.replace(/<[^>]+>/g, "").slice(0, 500),
        url: link,
        published_at: updated ? new Date(updated).toISOString() : new Date().toISOString(),
      });
    }
  }
  return items;
}

function parseSitemap(xml: string): ParsedArticle[] {
  const items: ParsedArticle[] = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  let match;
  while ((match = urlRegex.exec(xml)) !== null) {
    const c = match[1];
    const locMatch = c.match(/<loc>(.*?)<\/loc>/i);
    const lastmodMatch = c.match(/<lastmod>(.*?)<\/lastmod>/i);
    const newsTitle = c.match(/<news:title>(.*?)<\/news:title>/i);
    const newsPubDate = c.match(/<news:publication_date>(.*?)<\/news:publication_date>/i);
    if (locMatch) {
      const url = locMatch[1].trim();
      items.push({
        title: newsTitle ? newsTitle[1].trim() : url.split("/").filter(Boolean).pop() || url,
        snippet: "",
        url,
        published_at: (newsPubDate || lastmodMatch)
          ? new Date((newsPubDate || lastmodMatch)![1]).toISOString()
          : new Date().toISOString(),
      });
    }
  }
  return items;
}

function parseHTMLArticles(html: string, baseUrl: string): ParsedArticle[] {
  const items: ParsedArticle[] = [];
  const patterns = [
    /<article[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<h[1-3][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ];
  const seen = new Set<string>();
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(html)) !== null && items.length < 30) {
      const href = match[1];
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      if (text.length > 10 && !href.startsWith("#") && !href.startsWith("javascript") && !seen.has(href)) {
        seen.add(href);
        const fullUrl = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
        items.push({ title: text.slice(0, 200), snippet: "", url: fullUrl, published_at: new Date().toISOString() });
      }
    }
  }
  return items;
}

async function scrapeArticleMeta(url: string): Promise<{ snippet: string; published_at?: string }> {
  try {
    const resp = await fetchWithTimeout(url, 8000);
    if (!resp.ok) return { snippet: "" };
    const html = await resp.text();
    // Meta description
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
      || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const snippet = descMatch ? descMatch[1].slice(0, 500) : "";
    // Published date
    const dateMatch = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    return { snippet, published_at: dateMatch ? dateMatch[1] : undefined };
  } catch {
    return { snippet: "" };
  }
}

// ── Sentiment ────────────────────────────────────────────

async function analyzeSentimentBatch(
  items: { title: string; snippet: string }[],
  apiKey: string
): Promise<{ sentiment: string; score: number }[]> {
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
                      score: { type: "number", description: "Confidence 0.0-1.0" },
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
          { role: "system", content: "Classify the sentiment of each news article as positive, neutral, or negative. Return results for all articles." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (response.status === 429 || response.status === 402) {
      console.warn("AI rate limited or credits exhausted, defaulting to neutral");
      return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
    }
    if (!response.ok) {
      console.error("AI error:", response.status, await response.text());
      return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      const results = parsed.results || [];
      return items.map((_, i) => {
        const r = results.find((x: any) => x.index === i);
        return r ? { sentiment: r.sentiment, score: r.score } : { sentiment: "neutral", score: 0.5 };
      });
    }
    return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
  } catch (e) {
    console.error("Sentiment analysis error:", e);
    return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
  }
}

// ── Domain rate limiter ──────────────────────────────────

const domainLastFetch: Record<string, number> = {};

async function rateLimitedFetch(url: string, crawlDelayMs: number): Promise<Response> {
  const domain = new URL(url).hostname;
  const now = Date.now();
  const last = domainLastFetch[domain] || 0;
  const wait = Math.max(0, crawlDelayMs - (now - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  domainLastFetch[domain] = Date.now();
  return fetchWithTimeout(url);
}

// ── Main handler ─────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const maxSources = body.max_sources || 50;

    const { data: sources, error: srcErr } = await supabase
      .from("sources").select("*").eq("active", true).limit(maxSources);
    if (srcErr) throw srcErr;

    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];

    let totalInserted = 0;
    let totalErrors = 0;
    const keywordMatchUpdates: Record<string, number> = {};

    const CONCURRENCY = 5;
    for (let i = 0; i < (sources || []).length; i += CONCURRENCY) {
      const batch = sources!.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (source) => {
          try {
            const sourceType = source.source_type || "rss";
            const crawlDelay = source.crawl_delay_ms || 2000;
            let articles: ParsedArticle[] = [];

            if (sourceType === "rss" || sourceType === "atom") {
              const resp = await rateLimitedFetch(source.rss_url, crawlDelay);
              if (!resp.ok) {
                await supabase.from("sources").update({
                  health_status: "error",
                  consecutive_failures: (source.consecutive_failures || 0) + 1,
                }).eq("id", source.id);
                return { sourceId: source.id, items: [], error: `HTTP ${resp.status}` };
              }
              const xml = await resp.text();
              articles = parseRSSAtom(xml);

            } else if (sourceType === "sitemap" || sourceType === "news_sitemap") {
              const resp = await rateLimitedFetch(source.rss_url, crawlDelay);
              if (!resp.ok) {
                await supabase.from("sources").update({
                  health_status: "error",
                  consecutive_failures: (source.consecutive_failures || 0) + 1,
                }).eq("id", source.id);
                return { sourceId: source.id, items: [], error: `HTTP ${resp.status}` };
              }
              const xml = await resp.text();
              articles = parseSitemap(xml);
              // Limit to recent 30 items for sitemaps
              articles = articles.slice(0, 30);

            } else if (sourceType === "html") {
              const resp = await rateLimitedFetch(source.rss_url, crawlDelay);
              if (!resp.ok) {
                await supabase.from("sources").update({
                  health_status: "error",
                  consecutive_failures: (source.consecutive_failures || 0) + 1,
                }).eq("id", source.id);
                return { sourceId: source.id, items: [], error: `HTTP ${resp.status}` };
              }
              const html = await resp.text();
              const baseUrl = new URL(source.rss_url).origin;
              articles = parseHTMLArticles(html, baseUrl);

              // Enrich first 10 articles with meta from individual pages
              const toEnrich = articles.slice(0, 10);
              for (const article of toEnrich) {
                await new Promise((r) => setTimeout(r, Math.max(500, crawlDelay)));
                const meta = await scrapeArticleMeta(article.url);
                if (meta.snippet) article.snippet = meta.snippet;
                if (meta.published_at) article.published_at = new Date(meta.published_at).toISOString();
              }
            }

            // Update source health
            const failures = source.consecutive_failures || 0;
            await supabase.from("sources").update({
              last_fetched_at: new Date().toISOString(),
              last_success_at: new Date().toISOString(),
              health_status: "healthy",
              consecutive_failures: 0,
            }).eq("id", source.id);

            return { sourceId: source.id, items: articles, error: null };
          } catch (e) {
            console.error(`Error fetching ${source.name}:`, e);
            const failures = (source.consecutive_failures || 0) + 1;
            const status = failures >= 4 ? "failing" : failures >= 1 ? "degraded" : "error";
            await supabase.from("sources").update({
              health_status: status,
              consecutive_failures: failures,
            }).eq("id", source.id);
            return { sourceId: source.id, items: [], error: String(e) };
          }
        })
      );

      for (const result of results) {
        if (result.status === "rejected") { totalErrors++; continue; }
        const { sourceId, items, error } = result.value;
        if (error) { totalErrors++; continue; }

        const articlesToInsert = items.map((item) => {
          const matchedKws: string[] = [];
          for (const kw of activeKeywords) {
            if (item.title.toLowerCase().includes(kw.text.toLowerCase()) ||
                item.snippet.toLowerCase().includes(kw.text.toLowerCase())) {
              matchedKws.push(kw.text);
              keywordMatchUpdates[kw.id] = (keywordMatchUpdates[kw.id] || 0) + 1;
            }
          }
          return {
            title: item.title,
            snippet: item.snippet.slice(0, 500),
            url: item.url,
            source_id: sourceId,
            published_at: item.published_at,
            fetched_at: new Date().toISOString(),
            matched_keywords: matchedKws,
            language: "en",
          };
        });

        const BATCH_SIZE = 10;
        for (let b = 0; b < articlesToInsert.length; b += BATCH_SIZE) {
          const articleBatch = articlesToInsert.slice(b, b + BATCH_SIZE);
          const sentiments = await analyzeSentimentBatch(
            articleBatch.map((a) => ({ title: a.title, snippet: a.snippet || "" })),
            lovableApiKey
          );
          const withSentiment = articleBatch.map((a, idx) => ({
            ...a,
            sentiment: sentiments[idx].sentiment,
            sentiment_score: sentiments[idx].score,
          }));
          const { data: inserted, error: insertErr } = await supabase
            .from("articles")
            .upsert(withSentiment, { onConflict: "url", ignoreDuplicates: false })
            .select("id");
          if (insertErr) {
            console.error("Insert error:", insertErr);
            totalErrors++;
          } else {
            totalInserted += (inserted?.length || 0);
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }

    for (const [kwId, addCount] of Object.entries(keywordMatchUpdates)) {
      const kw = activeKeywords.find((k) => k.id === kwId);
      if (kw) {
        await supabase.from("keywords").update({ match_count: kw.match_count + addCount }).eq("id", kwId);
      }
    }

    const summary = { totalInserted, totalErrors, sourcesProcessed: sources?.length || 0 };
    console.log("Fetch complete:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fetch-rss error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
