import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; MediaPulse/1.0)" } });
  } finally { clearTimeout(timeout); }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","oc"].forEach(p => u.searchParams.delete(p));
    u.hash = "";
    if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch { return url; }
}

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//i,"").replace(/^www\./i,"").replace(/\/.*$/,"").trim().toLowerCase();
}

function getXmlTag(c: string, tag: string): string {
  const m = c.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function stripHtml(t: string): string {
  return t.replace(/<[^>]+>/g," ").replace(/&[a-z0-9#]+;/gi," ").replace(/\s+/g," ").trim();
}

function normalizeText(t: string): string {
  return stripHtml(t).toLowerCase().replace(/[_-]+/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}

function matchKeywords(text: string, keywords: string[]): string[] {
  const n = normalizeText(text);
  return keywords.filter(kw => n.includes(normalizeText(kw)));
}

function extractTitleFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last).replace(/\.(html?|php|aspx?)$/i,"").replace(/[-_]+/g," ").trim();
  } catch { return url; }
}

function parseSitemapIndex(xml: string): string[] {
  const urls: string[] = [];
  const re = /<sitemap>([\s\S]*?)<\/sitemap>/gi;
  let m; while ((m = re.exec(xml)) !== null) { const loc = getXmlTag(m[1],"loc"); if (loc) urls.push(loc); }
  return urls;
}

interface SitemapItem { title: string; url: string; snippet: string; published_at: string; source_domain: string; source_name: string; }

function parseSitemapItems(xml: string, domain: string, name: string): SitemapItem[] {
  const items: SitemapItem[] = [];
  const re = /<url>([\s\S]*?)<\/url>/gi;
  let m; while ((m = re.exec(xml)) !== null) {
    const url = getXmlTag(m[1],"loc"); if (!url) continue;
    const title = stripHtml(getXmlTag(m[1],"news:title") || extractTitleFromUrl(url)).slice(0,220);
    const snippet = stripHtml(getXmlTag(m[1],"news:keywords")).slice(0,500);
    const pubDate = getXmlTag(m[1],"news:publication_date") || getXmlTag(m[1],"lastmod");
    items.push({ title, url, snippet, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), source_domain: normalizeDomain(domain), source_name: name });
  }
  return items;
}

async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(url, 6000);
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html")) { await resp.text(); return null; }
    const html = await resp.text();
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return (bodyMatch ? bodyMatch[1] : html)
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi," ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi," ")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi," ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi," ")
      .replace(/<[^>]+>/g," ").replace(/&[a-z]+;/gi," ").replace(/\s+/g," ").trim().slice(0,10000);
  } catch { return null; }
}

async function analyzeSentimentBatch(items: {title:string;snippet:string}[], apiKey: string): Promise<{sentiment:string;score:number}[]> {
  if (!items.length) return [];
  const prompt = items.map((it,i) => `[${i}] Title: ${it.title}\nSnippet: ${it.snippet}`).join("\n\n");
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method:"POST", headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
      body: JSON.stringify({model:"google/gemini-2.5-flash-lite",tools:[{type:"function",function:{name:"classify_sentiments",description:"Classify sentiment",parameters:{type:"object",properties:{results:{type:"array",items:{type:"object",properties:{index:{type:"number"},sentiment:{type:"string",enum:["positive","neutral","negative"]},score:{type:"number"}},required:["index","sentiment","score"]}}},required:["results"]}}}],tool_choice:{type:"function",function:{name:"classify_sentiments"}},messages:[{role:"system",content:"Classify the sentiment of each news article."},{role:"user",content:prompt}]}),
    });
    if (!r.ok) return items.map(()=>({sentiment:"neutral",score:0.5}));
    const d = JSON.parse(await r.text());
    const tc = d.choices?.[0]?.message?.tool_calls?.[0];
    if (tc?.function?.arguments) { const p = JSON.parse(tc.function.arguments); const res = p.results||[]; return items.map((_,i)=>{ const x=res.find((r:any)=>r.index===i); return x?{sentiment:x.sentiment,score:x.score}:{sentiment:"neutral",score:0.5}; }); }
    return items.map(()=>({sentiment:"neutral",score:0.5}));
  } catch { return items.map(()=>({sentiment:"neutral",score:0.5})); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const maxDomains = body.max_domains || 5;
    const deepScanLimit = body.deep_scan_limit || 20;

    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (!activeKeywords.length) return new Response(JSON.stringify({ discovered: 0, message: "No active keywords" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const searchTerms = activeKeywords.map(k => k.text);
    const { data: sources } = await supabase.from("sources").select("id, rss_url, domain");
    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls||[]).map(a => normalizeUrl(a.url)));

    const { data: domains } = await supabase.from("approved_domains").select("*").eq("active",true).eq("approval_status","approved").order("priority",{ascending:false}).limit(maxDomains);

    let discovered: { title:string; snippet:string; url:string; published_at:string; source_domain:string; source_name:string; matched_keywords:string[] }[] = [];
    let unmatchedForDeepScan: SitemapItem[] = [];

    for (const dom of (domains||[])) {
      const domain = normalizeDomain(dom.domain);
      const name = dom.name || domain;
      console.log(`Sitemap scanning ${domain}...`);

      // Find sitemaps from robots.txt
      const sitemapUrls: string[] = [];
      try {
        const robotsResp = await fetchWithTimeout(`https://${domain}/robots.txt`, 5000);
        if (robotsResp.ok) {
          const robotsTxt = await robotsResp.text();
          for (const line of robotsTxt.split(/\r?\n/)) {
            const match = line.match(/^Sitemap:\s*(.+)$/i);
            if (match?.[1]) sitemapUrls.push(match[1].trim());
          }
        }
      } catch {}

      // Also try news-sitemap.xml
      if (!sitemapUrls.some(u => u.includes("news-sitemap"))) {
        sitemapUrls.push(`https://${domain}/news-sitemap.xml`);
      }

      // Process max 4 sitemaps per domain, max 2 child sitemaps each
      let allItems: SitemapItem[] = [];
      for (const sitemapUrl of sitemapUrls.slice(0, 4)) {
        try {
          const resp = await fetchWithTimeout(sitemapUrl, 8000);
          if (!resp.ok) { await resp.text().catch(()=>{}); continue; }
          const xml = await resp.text();

          if (/<sitemapindex/i.test(xml)) {
            // It's an index - take only the last 2 child sitemaps (most recent)
            const children = parseSitemapIndex(xml).slice(-2);
            for (const childUrl of children) {
              try {
                const childResp = await fetchWithTimeout(childUrl, 8000);
                if (!childResp.ok) { await childResp.text().catch(()=>{}); continue; }
                const childXml = await childResp.text();
                allItems.push(...parseSitemapItems(childXml, domain, name).slice(-20));
              } catch {}
            }
          } else if (/<urlset/i.test(xml)) {
            allItems.push(...parseSitemapItems(xml, domain, name).slice(-30));
          }
        } catch {}
      }

      console.log(`${domain}: ${allItems.length} sitemap URLs found`);

      for (const item of allItems) {
        if (existingUrlSet.has(normalizeUrl(item.url))) continue;
        const kws = matchKeywords(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
        if (kws.length > 0) {
          discovered.push({ ...item, matched_keywords: kws });
        } else {
          unmatchedForDeepScan.push(item);
        }
      }
    }

    // Deep scan unmatched items
    const toScan = unmatchedForDeepScan.filter(it => !existingUrlSet.has(normalizeUrl(it.url))).slice(0, deepScanLimit);
    if (toScan.length > 0) {
      console.log(`Deep scanning ${toScan.length} sitemap articles for body keyword matches...`);
      for (let i = 0; i < toScan.length; i += 3) {
        const batch = toScan.slice(i, i + 3);
        const results = await Promise.allSettled(batch.map(async item => {
          const body = await fetchArticleText(item.url);
          if (!body) return null;
          const kws = matchKeywords(body, searchTerms);
          return kws.length > 0 ? { ...item, matched_keywords: kws } : null;
        }));
        for (const r of results) { if (r.status === "fulfilled" && r.value) discovered.push(r.value); }
      }
    }

    // Dedup
    const seen = new Set<string>();
    discovered = discovered.filter(a => {
      const n = normalizeUrl(a.url);
      if (seen.has(n) || existingUrlSet.has(n)) return false;
      seen.add(n); return true;
    });

    console.log(`Sitemap discovery: ${discovered.length} new articles to insert`);

    // Insert with sentiment
    let totalInserted = 0;
    const keywordMatchUpdates: Record<string,number> = {};

    for (let b = 0; b < discovered.length; b += 10) {
      const batch = discovered.slice(b, b + 10);
      const toInsert = batch.map(a => {
        for (const kw of a.matched_keywords) { const k = activeKeywords.find(x=>x.text===kw); if (k) keywordMatchUpdates[k.id]=(keywordMatchUpdates[k.id]||0)+1; }
        const src = sources?.find(s => normalizeDomain(s.domain||"") === normalizeDomain(a.source_domain));
        return { title: a.title, snippet: a.snippet.slice(0,500), url: a.url, source_id: src?.id||null, published_at: a.published_at, fetched_at: new Date().toISOString(), matched_keywords: a.matched_keywords, language: "en", sentiment: "neutral" as string, sentiment_score: 0.5 };
      });
      const sentiments = await analyzeSentimentBatch(toInsert.map(a=>({title:a.title,snippet:a.snippet||""})), lovableApiKey);
      toInsert.forEach((a,i) => { a.sentiment = sentiments[i].sentiment; a.sentiment_score = sentiments[i].score; });
      const { data: ins, error } = await supabase.from("articles").upsert(toInsert, { onConflict: "url", ignoreDuplicates: true }).select("id");
      if (error) console.error("Insert error:", error); else totalInserted += ins?.length || 0;
    }

    for (const [id, count] of Object.entries(keywordMatchUpdates)) {
      const kw = activeKeywords.find(k=>k.id===id);
      if (kw) await supabase.from("keywords").update({ match_count: kw.match_count + count }).eq("id", id);
    }

    const summary = { discovered: totalInserted, sitemapArticlesScanned: unmatchedForDeepScan.length, deepScanned: toScan.length, domainsScanned: (domains||[]).length };
    console.log("Sitemap discovery complete:", summary);
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("discover-sitemaps error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
