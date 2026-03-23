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

    // Get existing keywords
    const { data: keywords } = await supabase.from("keywords").select("text, active, logic_operator");
    const existingKeywords = (keywords || []).map((k: any) => k.text);

    if (!existingKeywords.length) {
      return new Response(JSON.stringify({ suggestions: [], message: "Add some keywords first" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get company context from settings
    const { data: settings } = await supabase.from("settings").select("company_name").limit(1).single();
    const companyName = settings?.company_name || "the company";

    const prompt = `You are a media monitoring expert. Given these existing tracking keywords for ${companyName}:

${existingKeywords.map((k: string) => `- "${k}"`).join("\n")}

Suggest 5-8 additional related keywords that would help discover more relevant articles. Consider:
- Synonyms and alternative phrasings (e.g. "wave energy" → "wave power", "ocean energy")
- Related technologies, companies, or industry terms
- Common misspellings or abbreviations
- Broader/narrower terms in the same domain

Do NOT repeat any existing keywords. Each suggestion should be concise (1-4 words).`;

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
            name: "suggest_keywords",
            description: "Return keyword suggestions",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      keyword: { type: "string", description: "The suggested keyword" },
                      reason: { type: "string", description: "Brief reason why this keyword is relevant (max 10 words)" },
                    },
                    required: ["keyword", "reason"],
                  },
                },
              },
              required: ["suggestions"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_keywords" } },
        messages: [
          { role: "system", content: "You are a media monitoring keyword strategist." },
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
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      // Filter out any that match existing keywords
      const filtered = (parsed.suggestions || []).filter(
        (s: any) => !existingKeywords.some((ek: string) => ek.toLowerCase() === s.keyword.toLowerCase())
      );
      return new Response(JSON.stringify({ suggestions: filtered }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ suggestions: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-keywords error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
