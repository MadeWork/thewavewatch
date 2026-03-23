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
  domain: string;
  source_name: string;
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "MediaPulse/1.0 ArticleDiscovery" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseRSSForKeywords(xml: string, keywords: string[]): DiscoveredArticle[] {
  const articles: DiscoveredArticle[] = [];
  const kwLower = keywords.map(k => k.toLowerCase());

  // Parse RSS items
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
    const pubDate = getTag("pubDate") || getTag("dc:date") || getTag("published");

    if (title && link) {
      const combined = (title + " " + description).toLowerCase();
      if (kwLower.some(kw => combined.includes(kw))) {
        articles.push({
          title,
          snippet: description,
          url: link,
          published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          domain: "",
          source_name: "",
        });
      }
    }
  }

  // Parse Atom entries
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
    const snippet = summary.replace(/<[^>]+>/g, "").slice(0, 500);
    const updated = getTag("updated") || getTag("published");

    if (title && link) {
      const combined = (title + " " + snippet).toLowerCase();
      if (kwLower.some(kw => combined.includes(kw))) {
        articles.push({
          title,
          snippet,
          url: link,
          published_at: updated ? new Date(updated).toISOString() : new Date().toISOString(),
          domain: "",
          source_name: "",
        });
      }
    }
  }
  return articles;
}

async function searchDomainFeed(
  domain: { name: string; domain: string; feed_url: string | null },
  keywords: string[]
): Promise<DiscoveredArticle[]> {
  if (!domain.feed_url) return [];

  try {
    const resp = await fetchWithTimeout(domain.feed_url);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const articles = parseRSSForKeywords(xml, keywords);
    return articles.map(a => ({ ...a, domain: domain.domain, source_name: domain.name }));
  } catch {
    return [];
  }
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
    const maxDomains = body.max_domains || 50;
    const regionFilter = body.region || null;

    // Load keywords
    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (activeKeywords.length === 0) {
      return new Response(JSON.stringify({ discovered: 0, message: "No active keywords configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Also use company name from settings
    const { data: settings } = await supabase.from("settings").select("company_name").limit(1).maybeSingle();
    const searchTerms = activeKeywords.map(k => k.text);
    if (settings?.company_name && settings.company_name !== "My Company") {
      searchTerms.push(settings.company_name);
    }

    // Load approved domains with feeds, prioritized
    let domainsQuery = supabase
      .from("approved_domains")
      .select("*")
      .eq("active", true)
      .eq("approval_status", "approved")
      .not("feed_url", "is", null)
      .order("priority", { ascending: false })
      .limit(maxDomains);

    if (regionFilter) {
      domainsQuery = domainsQuery.eq("region", regionFilter);
    }

    const { data: domains } = await domainsQuery;
    if (!domains || domains.length === 0) {
      return new Response(JSON.stringify({ discovered: 0, message: "No approved domains with feeds" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get existing source_ids for linking
    const { data: sources } = await supabase.from("sources").select("id, rss_url, domain");

    // Search domains in batches of 5
    let allDiscovered: DiscoveredArticle[] = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < domains.length; i += CONCURRENCY) {
      const batch = domains.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(d => searchDomainFeed(d, searchTerms))
      );
      for (const r of results) {
        if (r.status === "fulfilled") allDiscovered.push(...r.value);
      }
      if (i + CONCURRENCY < domains.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`Discovery: found ${allDiscovered.length} matching articles across ${domains.length} domains`);

    // Deduplicate by URL
    const seen = new Set<string>();
    allDiscovered = allDiscovered.filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    // Find or match source_id
    let totalInserted = 0;
    const keywordMatchUpdates: Record<string, number> = {};
    const BATCH_SIZE = 10;

    for (let b = 0; b < allDiscovered.length; b += BATCH_SIZE) {
      const batch = allDiscovered.slice(b, b + BATCH_SIZE);

      // Find matching source or use null
      const articlesToInsert = batch.map(a => {
        const matchedKws: string[] = [];
        for (const kw of activeKeywords) {
          if (a.title.toLowerCase().includes(kw.text.toLowerCase()) ||
              a.snippet.toLowerCase().includes(kw.text.toLowerCase())) {
            matchedKws.push(kw.text);
            keywordMatchUpdates[kw.id] = (keywordMatchUpdates[kw.id] || 0) + 1;
          }
        }

        // Try to find matching source
        const matchedSource = sources?.find(s =>
          s.domain === a.domain || (s.rss_url && new URL(s.rss_url).hostname.includes(a.domain))
        );

        return {
          title: a.title,
          snippet: a.snippet.slice(0, 500),
          url: a.url,
          source_id: matchedSource?.id || null,
          published_at: a.published_at,
          fetched_at: new Date().toISOString(),
          matched_keywords: matchedKws,
          language: "en",
        };
      });

      // Sentiment analysis
      const sentiments = await analyzeSentimentBatch(
        articlesToInsert.map(a => ({ title: a.title, snippet: a.snippet || "" })),
        lovableApiKey
      );

      const withSentiment = articlesToInsert.map((a, idx) => ({
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
      } else {
        totalInserted += (inserted?.length || 0);
      }

      await new Promise(r => setTimeout(r, 300));
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
      domainsSearched: domains.length,
      candidatesFound: allDiscovered.length,
      keywordsUsed: searchTerms,
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
