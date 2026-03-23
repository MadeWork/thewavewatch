import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { article_id } = await req.json();
    if (!article_id) {
      return new Response(JSON.stringify({ error: "article_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if already enriched
    const { data: existing } = await supabase
      .from("article_enrichments")
      .select("*")
      .eq("article_id", article_id)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ success: true, data: existing, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get article
    const { data: article, error: artErr } = await supabase
      .from("articles")
      .select("*")
      .eq("id", article_id)
      .single();

    if (artErr || !article) {
      return new Response(JSON.stringify({ error: "Article not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Scrape the article page using Firecrawl
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    let pageContent = "";
    let scrapedData: any = null;

    if (firecrawlKey) {
      try {
        console.log("Scraping article:", article.url);
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: article.url,
            formats: ["markdown"],
            onlyMainContent: true,
          }),
        });

        if (scrapeRes.ok) {
          scrapedData = await scrapeRes.json();
          pageContent = scrapedData?.data?.markdown || scrapedData?.markdown || "";
          console.log(`Scraped ${pageContent.length} chars`);
        } else {
          console.warn("Firecrawl scrape failed:", scrapeRes.status);
        }
      } catch (e) {
        console.warn("Firecrawl error:", e);
      }
    }

    // Use Lovable AI to extract structured information
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "AI not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const truncatedContent = pageContent.slice(0, 8000);

    const extractionPrompt = `Analyze this article and extract structured information. Return ONLY valid JSON, no markdown.

Article Title: ${article.title}
Article URL: ${article.url}
Article Snippet: ${article.snippet || "N/A"}
${truncatedContent ? `\nFull Article Content:\n${truncatedContent}` : ""}

Extract the following as JSON:
{
  "author_name": "string or null - the author's full name",
  "author_email": "string or null - author's email if visible on the page",
  "author_url": "string or null - link to author's profile/bio page",
  "author_bio": "string or null - short bio of the author (1-2 sentences)",
  "author_social": {
    "twitter": "string or null",
    "linkedin": "string or null",
    "website": "string or null"
  },
  "key_quotes": ["array of 1-3 most important quotes/sentences from the article"],
  "summary": "A 2-3 sentence summary of the article's main points",
  "comments_summary": "string or null - summary of reader comments if visible, otherwise null"
}

Be precise. If information is not available, use null. Do not invent data.`;

    const aiRes = await fetch("https://ai.lovable.dev/api/generate", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        prompt: extractionPrompt,
      }),
    });

    let enrichment: any = {
      article_id,
      author_name: null,
      author_email: null,
      author_url: null,
      author_bio: null,
      author_social: {},
      comments: [],
      full_text: truncatedContent || null,
      key_quotes: [],
    };

    if (aiRes.ok) {
      const aiData = await aiRes.json();
      const text = aiData?.text || aiData?.choices?.[0]?.message?.content || "";
      console.log("AI response length:", text.length);

      try {
        // Extract JSON from response (may be wrapped in markdown)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          enrichment.author_name = parsed.author_name || null;
          enrichment.author_email = parsed.author_email || null;
          enrichment.author_url = parsed.author_url || null;
          enrichment.author_bio = parsed.author_bio || null;
          enrichment.author_social = parsed.author_social || {};
          enrichment.key_quotes = parsed.key_quotes || [];
          if (parsed.summary) enrichment.full_text = parsed.summary;
          if (parsed.comments_summary) {
            enrichment.comments = [{ type: "summary", text: parsed.comments_summary }];
          }
        }
      } catch (parseErr) {
        console.warn("Failed to parse AI response:", parseErr);
      }
    } else {
      console.warn("AI call failed:", aiRes.status);
    }

    // Save enrichment
    const { data: saved, error: saveErr } = await supabase
      .from("article_enrichments")
      .upsert(enrichment, { onConflict: "article_id" })
      .select()
      .single();

    if (saveErr) {
      console.error("Save error:", saveErr);
      return new Response(JSON.stringify({ error: "Failed to save enrichment" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Also update the articles table with author info
    if (enrichment.author_name) {
      await supabase.from("articles").update({
        author_name: enrichment.author_name,
        author_email: enrichment.author_email,
        author_url: enrichment.author_url,
      }).eq("id", article_id);
    }

    return new Response(JSON.stringify({ success: true, data: saved, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Enrich error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
