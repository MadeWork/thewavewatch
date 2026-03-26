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

    // Get all active keywords
    const { data: keywords } = await supabase.from("keywords").select("id, text, expanded_terms, active").eq("active", true);
    if (!keywords?.length) {
      return new Response(JSON.stringify({ expanded: 0, message: "No active keywords" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get company context
    const { data: settings } = await supabase.from("settings").select("company_name").limit(1).single();
    const companyName = settings?.company_name || "the company";

    const body = await req.json().catch(() => ({}));
    const forceRefresh = body?.force === true;

    // Only expand keywords that don't have expansions yet (unless forced)
    const toExpand = forceRefresh ? keywords : keywords.filter(k => !k.expanded_terms?.length);
    if (!toExpand.length) {
      return new Response(JSON.stringify({ expanded: 0, message: "All keywords already expanded" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allKeywordTexts = keywords.map(k => k.text);

    const prompt = `You are a media monitoring expert for ${companyName}. For each keyword below, generate 5-10 semantically related search terms that would help find relevant articles. Include:
- Synonyms and alternative phrasings (e.g. "wave energy" → "wave power", "ocean wave power")
- Related industry/technical terms
- Abbreviations and acronyms
- Broader and narrower terms
- Common variations and alternative spellings

IMPORTANT: All terms must be in English only. No characters from other languages.

Keywords to expand:
${toExpand.map(k => `- "${k.text}"`).join("\n")}

All existing keywords (don't duplicate these exactly): ${allKeywordTexts.join(", ")}

Each expansion should be 1-4 words in English. Focus on terms that would appear in news articles.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        tools: [{
          type: "function",
          function: {
            name: "expand_keywords",
            description: "Return semantic expansions for each keyword",
            parameters: {
              type: "object",
              properties: {
                expansions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      keyword: { type: "string", description: "The original keyword text" },
                      terms: {
                        type: "array",
                        items: { type: "string" },
                        description: "List of semantically related search terms",
                      },
                    },
                    required: ["keyword", "terms"],
                  },
                },
              },
              required: ["expansions"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "expand_keywords" } },
        messages: [
          { role: "system", content: "You are a media monitoring keyword strategist specializing in semantic search expansion." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    let expandedCount = 0;
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      const expansions = parsed.expansions || [];

      for (const exp of expansions) {
        const kw = toExpand.find(k => k.text.toLowerCase() === exp.keyword.toLowerCase());
        if (kw && exp.terms?.length) {
          // Deduplicate and clean terms
          const cleanTerms = [...new Set(
            exp.terms
              .map((t: string) => t.trim().toLowerCase())
              .filter((t: string) => t.length > 1 && t !== kw.text.toLowerCase())
          )];
          await supabase.from("keywords").update({ expanded_terms: cleanTerms }).eq("id", kw.id);
          expandedCount++;
        }
      }
    }

    return new Response(JSON.stringify({ expanded: expandedCount, total: toExpand.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("expand-keywords error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
