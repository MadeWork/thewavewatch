import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface RSSItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
}

function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1];
    const getTag = (tag: string) => {
      const m = content.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "si"));
      return m ? m[1].trim() : "";
    };
    const title = getTag("title");
    const link = getTag("link") || getTag("guid");
    const description = getTag("description");
    const pubDate = getTag("pubDate") || getTag("dc:date") || getTag("published");
    if (title && link) {
      items.push({ title, description: description.replace(/<[^>]+>/g, "").slice(0, 500), link, pubDate });
    }
  }
  return items;
}

async function analyzeSentimentBatch(
  items: { title: string; snippet: string }[],
  apiKey: string
): Promise<{ sentiment: string; score: number }[]> {
  const prompt = items.map((item, i) => `[${i}] Title: ${item.title}\nSnippet: ${item.snippet}`).join("\n\n");

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load active sources
    const { data: sources, error: srcErr } = await supabase
      .from("sources")
      .select("*")
      .eq("active", true);
    if (srcErr) throw srcErr;

    // Load active keywords
    const { data: keywords } = await supabase
      .from("keywords")
      .select("*")
      .eq("active", true);
    const activeKeywords = keywords || [];

    let totalInserted = 0;
    let totalErrors = 0;
    const keywordMatchUpdates: Record<string, number> = {};

    // Process sources with concurrency limit
    const CONCURRENCY = 5;
    for (let i = 0; i < (sources || []).length; i += CONCURRENCY) {
      const batch = sources!.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (source) => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const resp = await fetch(source.rss_url, {
              signal: controller.signal,
              headers: { "User-Agent": "MediaPulse/1.0 RSS Reader" },
            });
            clearTimeout(timeout);

            if (!resp.ok) {
              await supabase.from("sources").update({ health_status: "error" }).eq("id", source.id);
              return { sourceId: source.id, items: [], error: `HTTP ${resp.status}` };
            }

            const xml = await resp.text();
            const items = parseRSSItems(xml);

            await supabase.from("sources").update({
              last_fetched_at: new Date().toISOString(),
              health_status: "healthy",
            }).eq("id", source.id);

            return { sourceId: source.id, items, error: null };
          } catch (e) {
            console.error(`Error fetching ${source.name}:`, e);
            await supabase.from("sources").update({ health_status: "error" }).eq("id", source.id);
            return { sourceId: source.id, items: [], error: String(e) };
          }
        })
      );

      for (const result of results) {
        if (result.status === "rejected") {
          totalErrors++;
          continue;
        }
        const { sourceId, items, error } = result.value;
        if (error) { totalErrors++; continue; }

        // Match keywords and prepare articles
        const articlesToInsert = items.map((item) => {
          const matchedKws: string[] = [];
          for (const kw of activeKeywords) {
            if (item.title.toLowerCase().includes(kw.text.toLowerCase()) ||
                item.description.toLowerCase().includes(kw.text.toLowerCase())) {
              matchedKws.push(kw.text);
              keywordMatchUpdates[kw.id] = (keywordMatchUpdates[kw.id] || 0) + 1;
            }
          }
          return {
            title: item.title,
            snippet: item.description.slice(0, 500),
            url: item.link,
            source_id: sourceId,
            published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
            fetched_at: new Date().toISOString(),
            matched_keywords: matchedKws,
            language: "en",
          };
        });

        // Batch upsert articles (skip duplicates by url)
        const BATCH_SIZE = 10;
        for (let b = 0; b < articlesToInsert.length; b += BATCH_SIZE) {
          const articleBatch = articlesToInsert.slice(b, b + BATCH_SIZE);

          // Sentiment analysis
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
            .upsert(withSentiment, { onConflict: "url", ignoreDuplicates: true })
            .select("id");

          if (insertErr) {
            console.error("Insert error:", insertErr);
            totalErrors++;
          } else {
            totalInserted += (inserted?.length || 0);
          }

          // Small delay between batches
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }

    // Update keyword match counts
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
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
