import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const maxArticles = Math.min(Number(body.max_articles || 200), 500);

    // Get recent unclustered articles (last 7 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const { data: articles } = await supabase
      .from("articles")
      .select("id, title, snippet, source_domain, published_at, story_cluster_id")
      .is("story_cluster_id", null)
      .gte("fetched_at", cutoff.toISOString())
      .order("fetched_at", { ascending: false })
      .limit(maxArticles);

    if (!articles?.length) {
      return new Response(JSON.stringify({ clustered: 0, clusters: 0, message: "No unclustered articles" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Clustering ${articles.length} articles...`);

    // Process in batches of 40 for AI
    const BATCH_SIZE = 40;
    let totalClustered = 0;
    let totalClusters = 0;

    for (let b = 0; b < articles.length; b += BATCH_SIZE) {
      const batch = articles.slice(b, b + BATCH_SIZE);
      const prompt = batch.map((a, i) =>
        `[${i}] "${a.title}" (${a.source_domain || "unknown"}, ${a.published_at?.slice(0, 10) || "?"})`
      ).join("\n");

      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            tools: [{
              type: "function",
              function: {
                name: "cluster_stories",
                description: "Group articles that cover the same story/event",
                parameters: {
                  type: "object",
                  properties: {
                    clusters: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          story_label: { type: "string" },
                          article_indices: { type: "array", items: { type: "number" } },
                        },
                        required: ["story_label", "article_indices"],
                      },
                    },
                  },
                  required: ["clusters"],
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "cluster_stories" } },
            messages: [
              {
                role: "system",
                content: `Group these news articles into story clusters. Articles covering the same event, announcement, or story should be grouped together. Only group articles that are clearly about the same specific story — not just the same topic. Each cluster must have 2+ articles. Articles that are unique should NOT be clustered.`,
              },
              { role: "user", content: prompt },
            ],
          }),
        });

        if (!r.ok) continue;
        const d = await r.json();
        const tc = d.choices?.[0]?.message?.tool_calls?.[0];
        if (!tc?.function?.arguments) continue;

        const parsed = JSON.parse(tc.function.arguments);
        const clusters = parsed.clusters || [];

        for (const cluster of clusters) {
          if (!cluster.article_indices?.length || cluster.article_indices.length < 2) continue;

          // Generate a deterministic cluster ID
          const clusterId = crypto.randomUUID();
          const articleIds = cluster.article_indices
            .filter((i: number) => i >= 0 && i < batch.length)
            .map((i: number) => batch[i].id);

          if (articleIds.length < 2) continue;

          const { error } = await supabase
            .from("articles")
            .update({ story_cluster_id: clusterId } as any)
            .in("id", articleIds);

          if (!error) {
            totalClustered += articleIds.length;
            totalClusters++;
          }
        }
      } catch (e) {
        console.error("Clustering batch error:", e);
      }

      // Small delay between batches
      if (b + BATCH_SIZE < articles.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`Clustering complete: ${totalClustered} articles in ${totalClusters} clusters`);
    return new Response(JSON.stringify({ clustered: totalClustered, clusters: totalClusters }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cluster-stories error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
