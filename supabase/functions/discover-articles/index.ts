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

// ── Google News RSS Search ──────────────────────────────
// This is the key discovery method - searches across ALL indexed news sources

function buildGoogleNewsUrl(keyword: string, lang = "en"): string {
  const q = encodeURIComponent(keyword);
  return `https://news.google.com/rss/search?q=${q}&hl=${lang}&gl=US&ceid=US:${lang}`;
}

async function resolveGoogleNewsUrl(gnUrl: string): Promise<string> {
  // Google News RSS links are redirects — follow them to get the real URL
  try {
    const resp = await fetch(gnUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MediaPulse/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    // The final URL after redirects is the real article URL
    if (resp.url && !resp.url.includes("news.google.com")) {
      return resp.url;
    }
    // Try GET if HEAD didn't resolve
    const resp2 = await fetch(gnUrl, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MediaPulse/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    if (resp2.url && !resp2.url.includes("news.google.com")) {
      return resp2.url;
    }
    return gnUrl;
  } catch {
    return gnUrl;
  }
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
      // IMPORTANT: Use the <source url="..."> attribute as the real article URL
      // Google News <link> URLs are opaque redirects that can't be resolved server-side
      const realUrl = sourceMatch ? sourceMatch[1] : gnLink;
      let domain = "";
      try { domain = new URL(realUrl).hostname.replace("www.", ""); } catch {}

      articles.push({
        title,
        snippet: description,
        url: realUrl, // Use source URL directly, not the Google News redirect
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source_domain: domain,
        source_name: sourceMatch ? sourceMatch[2] : domain,
        matched_keywords: [keyword],
      });
    }
  }
  return articles;
}

// ── RSS Feed Search for approved domains ────────────────

function parseRSSForKeywords(xml: string, keywords: string[], domain: string, sourceName: string): DiscoveredArticle[] {
  const articles: DiscoveredArticle[] = [];
  const kwLower = keywords.map(k => k.toLowerCase());

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
      const combined = (title + " " + description).toLowerCase();
      const matchedKws = keywords.filter(kw => combined.includes(kw.toLowerCase()));
      if (matchedKws.length > 0) {
        articles.push({
          title, snippet: description, url: link,
          published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          source_domain: domain, source_name: sourceName,
          matched_keywords: matchedKws,
        });
      }
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
      const combined = (title + " " + summary).toLowerCase();
      const matchedKws = keywords.filter(kw => combined.includes(kw.toLowerCase()));
      if (matchedKws.length > 0) {
        articles.push({
          title, snippet: summary, url: link,
          published_at: updated ? new Date(updated).toISOString() : new Date().toISOString(),
          source_domain: domain, source_name: sourceName,
          matched_keywords: matchedKws,
        });
      }
    }
  }
  return articles;
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

    // ═══════════════════════════════════════════════════════
    // METHOD 1: Google News RSS Search (PRIMARY - searches ALL sources)
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
        // Rate limit between keyword searches
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
            if (!d.feed_url) return [];
            try {
              const resp = await fetchWithTimeout(d.feed_url);
              if (!resp.ok) return [];
              const xml = await resp.text();
              return parseRSSForKeywords(xml, searchTerms, d.domain, d.name);
            } catch { return []; }
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") allDiscovered.push(...r.value);
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
              if (!resp.ok) return [];
              const xml = await resp.text();
              const domain = s.domain || new URL(s.rss_url).hostname.replace("www.", "");
              return parseRSSForKeywords(xml, searchTerms, domain, s.name);
            } catch { return []; }
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") allDiscovered.push(...r.value);
        }
      }
    }

    console.log(`Total candidates before dedup: ${allDiscovered.length}`);

    // ═══════════════════════════════════════════════════════
    // DEDUPLICATION
    // ═══════════════════════════════════════════════════════
    const seen = new Set<string>();
    allDiscovered = allDiscovered.filter(a => {
      // Normalize URL for dedup
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

    // ═══════════════════════════════════════════════════════
    // RESOLVE GOOGLE NEWS REDIRECT URLS
    // ═══════════════════════════════════════════════════════
    const googleNewsArticles = allDiscovered.filter(a => a.url.includes("news.google.com"));
    if (googleNewsArticles.length > 0) {
      console.log(`Resolving ${googleNewsArticles.length} Google News redirect URLs...`);
      const RESOLVE_BATCH = 10;
      for (let i = 0; i < googleNewsArticles.length; i += RESOLVE_BATCH) {
        const batch = googleNewsArticles.slice(i, i + RESOLVE_BATCH);
        const resolved = await Promise.allSettled(
          batch.map(a => resolveGoogleNewsUrl(a.url))
        );
        resolved.forEach((r, idx) => {
          if (r.status === "fulfilled" && r.value) {
            batch[idx].url = r.value;
            try { batch[idx].source_domain = new URL(r.value).hostname.replace("www.", ""); } catch {}
          }
        });
        if (i + RESOLVE_BATCH < googleNewsArticles.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
      console.log(`Resolved ${googleNewsArticles.filter(a => !a.url.includes("news.google.com")).length} URLs`);
    }

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

    // Create candidate approved_domains for newly discovered sources
    if (newDomains.size > 0) {
      const candidates = Array.from(newDomains.entries()).map(([domain, info]) => ({
        domain,
        name: info.name || domain,
        approval_status: "pending",
        auto_discovered: true,
        active: false,
        priority: 30,
      }));

      // Only insert truly new domains
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
        // Update keyword match counts
        for (const kwText of a.matched_keywords) {
          const kw = activeKeywords.find(k => k.text === kwText);
          if (kw) keywordMatchUpdates[kw.id] = (keywordMatchUpdates[kw.id] || 0) + 1;
        }

        // Find matching source
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

      // Sentiment analysis
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

    // Update keyword match counts
    for (const [kwId, addCount] of Object.entries(keywordMatchUpdates)) {
      const kw = activeKeywords.find(k => k.id === kwId);
      if (kw) {
        await supabase.from("keywords").update({ match_count: kw.match_count + addCount }).eq("id", kwId);
      }
    }

    const summary = {
      discovered: totalInserted,
      totalCandidates: allDiscovered.length,
      newDomainsFound: newDomains.size,
      keywordsUsed: searchTerms,
      methods: ["google_news_rss", "approved_domain_feeds", "source_feeds"],
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
