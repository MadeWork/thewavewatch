// enrich-articles edge function
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const supabase = createClient(supabaseUrl, serviceKey);

  if (!lovableKey) {
    console.error("LOVABLE_API_KEY is not set — enrichment will fail");
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const { topic_id } = await req.json().catch(() => ({}));

    // 1. Fetch unenriched articles
    let query = supabase
      .from("articles")
      .select("id, title, description, source_name, source_url, url, published_at")
      .eq("is_enriched", false)
      .eq("is_duplicate", false)
      .order("fetched_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (topic_id) query = query.eq("topic_id", topic_id);

    const { data: articles, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!articles?.length) {
      return new Response(JSON.stringify({ message: "No articles to enrich", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Enriching ${articles.length} articles`);

    // 2. Get active keywords for context
    const { data: keywords } = await supabase.from("keywords").select("text").eq("active", true);
    const keywordList = (keywords || []).map((k: any) => k.text).join(", ");

    // 3. Score with Lovable AI
    let scores: any[] = [];
    try {
      scores = await scoreWithAI(lovableKey, keywordList, articles);
    } catch (err) {
      console.error("AI scoring failed:", err);
    }

    // 4. Near-duplicate detection
    const recentTitles = await getRecentTitles(supabase, articles.map(a => a.id));

    const updates: any[] = []
    let enriched = 0
    let duplicates = 0

    for (const article of articles) {
      const score = scores.find((s: any) => s.id === article.id) ?? {
        relevance_score: 0.5,
        relevance_label: 'medium',
        relevance_reason: 'Unscored — matched keyword filter',
        sentiment: 'neutral',
        sentiment_score: 0,
        key_themes: []
      }

      const existingDup = recentTitles.find(r => titlesAreSimilar(article.title, r.title))
      const batchDup = articles.find(other =>
        other.id !== article.id &&
        (other.published_at || "") <= (article.published_at || "") &&
        titlesAreSimilar(article.title, other.title)
      )

      const isDuplicate = !!(existingDup || batchDup)
      if (isDuplicate) duplicates++

      updates.push({
        id: article.id,
        relevance_score: score.relevance_score,
        relevance_label: score.relevance_label,
        relevance_reason: score.relevance_reason,
        sentiment: score.sentiment,
        sentiment_score: score.sentiment_score,
        key_themes: score.key_themes,
        is_duplicate: isDuplicate,
        duplicate_of: existingDup?.id || batchDup?.id || null,
        is_enriched: true,
        enriched_at: new Date().toISOString(),
      })
      enriched++
    }

    // Parallel updates (10 at a time)
    for (let i = 0; i < updates.length; i += 10) {
      const batch = updates.slice(i, i + 10)
      await Promise.all(batch.map(u => {
        const { id, ...fields } = u
        return supabase.from("articles").update(fields).eq("id", id)
      }))
    }

    console.log(`Enriched ${enriched}, duplicates: ${duplicates}`);

    return new Response(JSON.stringify({
      enriched,
      duplicates,
      scored: scores.length,
      total: articles.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("enrich-articles error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function scoreWithAI(apiKey: string, keywords: string, articles: any[]) {
  const articleList = articles.map((a, i) =>
    `[${i}] ID:${a.id}\nTitle: ${a.title}\nDescription: ${(a as any).description || "N/A"}\nSource: ${(a as any).source_name || (a as any).source_url || "Unknown"}`
  ).join("\n\n");

  const prompt = `You are a media monitoring relevance scorer for a professional intelligence platform.

KEYWORDS BEING MONITORED: ${keywords}

Score each article below for relevance to these monitored keywords. Be strict — this is a professional media monitoring tool and users need signal, not noise.

SCORING RULES:
- "high" (0.8–1.0): Directly about the topic/keywords. A PR or communications professional would definitely want to see this.
- "medium" (0.5–0.79): Tangentially related. Mentions the topic but it's not the main focus.
- "low" (0.2–0.49): Weak connection. Only incidentally mentions a keyword.
- "noise" (0.0–0.19): Irrelevant. Keyword match was coincidental. Should be filtered out.
- IMPORTANT: Treat synonyms and closely related terms as equivalent. For example, "marine energy" = "wave power" = "tidal energy" = "ocean energy". An article about "wave power funding" is HIGH relevance for "marine energy" keywords. Do NOT penalise articles for using different terminology than the exact monitored keywords.

For sentiment, score how the article portrays the topic/organisation:
- "positive": Favourable coverage, achievements, growth, praise
- "neutral": Factual reporting, no clear tone
- "negative": Criticism, problems, controversy, failure

Return ONLY a valid JSON array:
[
  {
    "id": "article-uuid",
    "relevance_score": 0.85,
    "relevance_label": "high",
    "relevance_reason": "Short reason why",
    "sentiment": "positive",
    "sentiment_score": 0.7,
    "key_themes": ["theme1", "theme2"]
  }
]

ARTICLES TO SCORE:
${articleList}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: "You score articles for relevance. Return only valid JSON arrays." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`AI API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "[]";
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    const jsonMatch = clean.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    console.error("AI returned non-JSON:", text.slice(0, 200));
    return [];
  }
}

async function getRecentTitles(supabase: any, excludeIds: string[]) {
  const { data } = await supabase
    .from("articles")
    .select("id, title")
    .eq("is_duplicate", false)
    .gte("published_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(200);

  return (data || []).filter((a: any) => !excludeIds.includes(a.id));
}

function titlesAreSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const wordsA = new Set(clean(a).split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(clean(b).split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) shared++;
  }

  const similarity = shared / Math.max(wordsA.size, wordsB.size);
  return similarity > 0.65;
}
