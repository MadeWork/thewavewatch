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

// ── Full-text extraction from HTML ─────────────────────
// Fetches an article URL and extracts visible text for keyword matching

async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(url, 8000);
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/xml") && !contentType.includes("application/xhtml")) {
      await resp.text(); // consume body
      return null;
    }
    const html = await resp.text();
    // Extract text from <body> if present, otherwise use full HTML
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : html;
    // Remove script and style tags entirely
    const cleaned = bodyHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/&#\d+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Return first 10000 chars to avoid excessive memory
    return cleaned.slice(0, 10000);
  } catch {
    return null;
  }
}

// ── Google News RSS Search ──────────────────────────────

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
    const getTag = (tag: string) => {
      const m = c.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "si"));
      return m ? m[1].trim() : "";
    };
    const title = getTag("title");
    const gnLink = getTag("link");
    const description = getTag("description").replace(/<[^>]+>/g, "").slice(0, 500);
    const pubDate = getTag("pubDate");
    const sourceMatch = c.match(/<source[^>]+url=["']([^"']+)["'][^>]*>(.*?)<\/source>/i);

    if (title && gnLink) {
      const realUrl = sourceMatch ? sourceMatch[1] : gnLink;
      let domain = "";
      try { domain = new URL(realUrl).hostname.replace("www.", ""); } catch {}

      articles.push({
        title,
        snippet: description,
        url: realUrl,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source_domain: domain,
        source_name: sourceMatch ? sourceMatch[2] : domain,
        matched_keywords: [keyword],
      });
    }
  }
  return articles;
}

// ── RSS Feed parsing ────────────────────────────────────
// Returns ALL items from a feed, with keyword matches noted (empty array if no title/snippet match)

function parseRSSItems(xml: string, domain: string, sourceName: string): RSSItem[] {
  const items: RSSItem[] = [];

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
    const description = getTag("description").replace(/<[^>]+>/g, "").slice(0, 500);
    const pubDate = getTag("pubDate") || getTag("dc:date");

    if (title && link) {
      items.push({
        title, url: link, snippet: description,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source_domain: domain, source_name: sourceName,
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
    const summary = (getTag("summary") || getTag("content")).replace(/<[^>]+>/g, "").slice(0, 500);
    const updated = getTag("updated") || getTag("published");

    if (title && link) {
      items.push({
        title, url: link, snippet: summary,
        published_at: updated ? new Date(updated).toISOString() : new Date().toISOString(),
        source_domain: domain, source_name: sourceName,
      });
    }
  }
  return items;
}

// Match keywords against text, returning matched keyword strings
function matchKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter(kw => lower.includes(kw.toLowerCase()));
}

// ── Full-text deep scan ─────────────────────────────────
// For RSS items that didn't match by title/snippet, fetch the article body and re-check

async function deepScanForKeywords(
  unmatchedItems: RSSItem[],
  keywords: string[],
  maxItems = 30,
): Promise<DiscoveredArticle[]> {
  const results: DiscoveredArticle[] = [];
  // Limit to avoid timeout
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
    for (const r of fetched) {
      if (r.status === "fulfilled" && r.value) {
        results.push(r.value);
      }
    }
  }
  return results;
}

// ── Sentiment Analysis ──────────────────────────────────

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
        const r = results.find((x: any) => x.index === i);
        return r ? { sentiment: r.sentiment, score: r.score } : { sentiment: "neutral", score: 0.5 };
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
    const maxDomainFeeds = body.max_domains || 100;
    const deepScanLimit = body.deep_scan_limit || 150; // max articles to full-text scan

    // Load keywords
    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (activeKeywords.length === 0) {
      return new Response(JSON.stringify({ discovered: 0, message: "No active keywords configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await supabase.from("settings").select("company_name").limit(1).maybeSingle();
    const searchTerms = activeKeywords.map(k => k.text);
    if (settings?.company_name && settings.company_name !== "My Company") {
      searchTerms.push(settings.company_name);
    }

    // Get existing sources for linking
    const { data: sources } = await supabase.from("sources").select("id, rss_url, domain");
    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls || []).map(a => a.url));

    let allDiscovered: DiscoveredArticle[] = [];
    let allUnmatchedItems: RSSItem[] = []; // items that didn't match by title/snippet

    // ═══════════════════════════════════════════════════════
    // METHOD 1: Google News RSS Search (PRIMARY)
    // ═══════════════════════════════════════════════════════
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
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.error(`Google News "${term}" error:`, e);
      }
    }

    // ═══════════════════════════════════════════════════════
    // METHOD 2: Approved domain feeds (SUPPLEMENTARY)
    // ═══════════════════════════════════════════════════════
    const { data: domains } = await supabase
      .from("approved_domains")
      .select("*")
      .eq("active", true)
      .eq("approval_status", "approved")
      .not("feed_url", "is", null)
      .order("priority", { ascending: false })
      .limit(maxDomainFeeds);

    if (domains && domains.length > 0) {
      console.log(`Searching ${domains.length} approved domain feeds...`);
      const CONCURRENCY = 5;
      for (let i = 0; i < domains.length; i += CONCURRENCY) {
        const batch = domains.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async d => {
            if (!d.feed_url) return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] };
            try {
              const resp = await fetchWithTimeout(d.feed_url);
              if (!resp.ok) return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] };
              const xml = await resp.text();
              const items = parseRSSItems(xml, d.domain, d.name);
              const matched: DiscoveredArticle[] = [];
              const unmatched: RSSItem[] = [];
              for (const item of items) {
                const kws = matchKeywords(item.title + " " + item.snippet, searchTerms);
                if (kws.length > 0) {
                  matched.push({ ...item, matched_keywords: kws });
                } else {
                  unmatched.push(item);
                }
              }
              return { matched, unmatched };
            } catch { return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] }; }
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            allDiscovered.push(...r.value.matched);
            allUnmatchedItems.push(...r.value.unmatched);
          }
        }
        if (i + CONCURRENCY < domains.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    // METHOD 3: Source RSS feeds (SUPPLEMENTARY)
    // ═══════════════════════════════════════════════════════
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
          batch.map(async s => {
            try {
              const resp = await fetchWithTimeout(s.rss_url);
              if (!resp.ok) return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] };
              const xml = await resp.text();
              const domain = s.domain || new URL(s.rss_url).hostname.replace("www.", "");
              const items = parseRSSItems(xml, domain, s.name);
              const matched: DiscoveredArticle[] = [];
              const unmatched: RSSItem[] = [];
              for (const item of items) {
                const kws = matchKeywords(item.title + " " + item.snippet, searchTerms);
                if (kws.length > 0) {
                  matched.push({ ...item, matched_keywords: kws });
                } else {
                  unmatched.push(item);
                }
              }
              return { matched, unmatched };
            } catch { return { matched: [] as DiscoveredArticle[], unmatched: [] as RSSItem[] }; }
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            allDiscovered.push(...r.value.matched);
            allUnmatchedItems.push(...r.value.unmatched);
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    // METHOD 4: FULL-TEXT DEEP SCAN (for unmatched RSS items)
    // ═══════════════════════════════════════════════════════
    // Filter out already-known URLs from unmatched items before scanning
    const unmatchedToScan = allUnmatchedItems.filter(item => !existingUrlSet.has(item.url));
    if (unmatchedToScan.length > 0) {
      console.log(`Deep scanning ${Math.min(unmatchedToScan.length, deepScanLimit)} of ${unmatchedToScan.length} unmatched articles for full-text keyword matches...`);
      const deepMatches = await deepScanForKeywords(unmatchedToScan, searchTerms, deepScanLimit);
      console.log(`Deep scan found ${deepMatches.length} additional articles with keyword matches in body text`);
      allDiscovered.push(...deepMatches);
    }

    console.log(`Total candidates before dedup: ${allDiscovered.length}`);

    // ═══════════════════════════════════════════════════════
    // DEDUPLICATION
    // ═══════════════════════════════════════════════════════
    const seen = new Set<string>();
    allDiscovered = allDiscovered.filter(a => {
      let normalizedUrl = a.url;
      try {
        const u = new URL(a.url);
        u.searchParams.delete("utm_source");
        u.searchParams.delete("utm_medium");
        u.searchParams.delete("utm_campaign");
        u.hash = "";
        normalizedUrl = u.toString();
      } catch {}
      if (seen.has(normalizedUrl) || existingUrlSet.has(a.url)) return false;
      seen.add(normalizedUrl);
      return true;
    });

    console.log(`After dedup: ${allDiscovered.length} new articles`);

    // Filter out any remaining unresolved Google News URLs
    allDiscovered = allDiscovered.filter(a => !a.url.includes("news.google.com/rss/articles"));

    // ═══════════════════════════════════════════════════════
    // AUTO-DISCOVER NEW SOURCES
    // ═══════════════════════════════════════════════════════
    const newDomains = new Map<string, { name: string; count: number }>();
    const knownDomains = new Set([
      ...(sources || []).map(s => s.domain).filter(Boolean),
      ...(domains || []).map(d => d.domain),
    ]);

    for (const article of allDiscovered) {
      if (article.source_domain && !knownDomains.has(article.source_domain)) {
        const existing = newDomains.get(article.source_domain);
        if (existing) {
          existing.count++;
        } else {
          newDomains.set(article.source_domain, { name: article.source_name, count: 1 });
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
        .in("domain", candidates.map(c => c.domain));
      const existingDomainSet = new Set((existingDomains || []).map(d => d.domain));
      const trulyNew = candidates.filter(c => !existingDomainSet.has(c.domain));

      if (trulyNew.length > 0) {
        await supabase.from("approved_domains").insert(trulyNew);
        console.log(`Auto-discovered ${trulyNew.length} new source domains`);
      }
    }

    // ═══════════════════════════════════════════════════════
    // INSERT ARTICLES WITH SENTIMENT
    // ═══════════════════════════════════════════════════════
    let totalInserted = 0;
    const keywordMatchUpdates: Record<string, number> = {};
    const BATCH_SIZE = 10;

    for (let b = 0; b < allDiscovered.length; b += BATCH_SIZE) {
      const batch = allDiscovered.slice(b, b + BATCH_SIZE);

      const articlesToInsert = batch.map(a => {
        for (const kwText of a.matched_keywords) {
          const kw = activeKeywords.find(k => k.text === kwText);
          if (kw) keywordMatchUpdates[kw.id] = (keywordMatchUpdates[kw.id] || 0) + 1;
        }

        const matchedSource = sources?.find(s =>
          s.domain === a.source_domain ||
          (s.rss_url && new URL(s.rss_url).hostname.replace("www.", "") === a.source_domain)
        );

        return {
          title: a.title,
          snippet: a.snippet.slice(0, 500),
          url: a.url,
          source_id: matchedSource?.id || null,
          published_at: a.published_at,
          fetched_at: new Date().toISOString(),
          matched_keywords: a.matched_keywords,
          language: "en",
          sentiment: "neutral" as string,
          sentiment_score: 0.5,
        };
      });

      const sentiments = await analyzeSentimentBatch(
        articlesToInsert.map(a => ({ title: a.title, snippet: a.snippet || "" })),
        lovableApiKey
      );
      articlesToInsert.forEach((a, idx) => {
        a.sentiment = sentiments[idx].sentiment;
        a.sentiment_score = sentiments[idx].score;
      });

      const { data: inserted, error: insertErr } = await supabase
        .from("articles")
        .upsert(articlesToInsert, { onConflict: "url", ignoreDuplicates: true })
        .select("id");

      if (insertErr) {
        console.error("Insert error:", insertErr);
      } else {
        totalInserted += (inserted?.length || 0);
      }
    }

    for (const [kwId, addCount] of Object.entries(keywordMatchUpdates)) {
      const kw = activeKeywords.find(k => k.id === kwId);
      if (kw) {
        await supabase.from("keywords").update({ match_count: kw.match_count + addCount }).eq("id", kwId);
      }
    }

    const summary = {
      discovered: totalInserted,
      totalCandidates: allDiscovered.length,
      deepScanned: Math.min(unmatchedToScan.length, deepScanLimit),
      newDomainsFound: newDomains.size,
      keywordsUsed: searchTerms,
      methods: ["google_news_rss", "approved_domain_feeds", "source_feeds", "full_text_deep_scan"],
    };
    console.log("Discovery complete:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("discover-articles error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
