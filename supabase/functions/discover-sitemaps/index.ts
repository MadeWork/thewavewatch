import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Utilities ────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; MediaPulse/1.0)" } });
  } finally { clearTimeout(timeout); }
}

async function fetchWithRetry(url: string, timeoutMs = 15000, maxRetries = 2, label = ""): Promise<Response | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    const start = Date.now();
    try {
      const resp = await fetchWithTimeout(url, timeoutMs);
      if (resp.status >= 500 && attempt < maxRetries) {
        await resp.text().catch(() => {});
        console.log(`[retry] ${label || url.slice(0, 60)}: HTTP ${resp.status}, attempt ${attempt + 1} (${Date.now() - start}ms)`);
        continue;
      }
      return resp;
    } catch (e: any) {
      const elapsed = Date.now() - start;
      if (attempt < maxRetries) {
        console.log(`[retry] ${label || url.slice(0, 60)}: ${e.name === "AbortError" ? `timeout (${timeoutMs}ms)` : e.message}, attempt ${attempt + 1} (${elapsed}ms)`);
        continue;
      }
      console.log(`[failed] ${label || url.slice(0, 60)}: ${e.message} after ${attempt + 1} attempts (${elapsed}ms)`);
      return null;
    }
  }
  return null;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "oc", "ref", "fbclid", "gclid"].forEach(p => u.searchParams.delete(p));
    u.hash = "";
    if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch { return url; }
}

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

const BLOCKED_DOMAINS = new Set([
  "facebook.com", "m.facebook.com", "l.facebook.com",
  "twitter.com", "x.com", "mobile.twitter.com",
  "instagram.com", "linkedin.com",
  "youtube.com", "m.youtube.com", "youtu.be",
  "tiktok.com", "reddit.com", "old.reddit.com",
  "pinterest.com", "tumblr.com", "snapchat.com",
  "threads.net", "mastodon.social", "bsky.app",
  "t.me", "telegram.org", "wa.me", "whatsapp.com",
  "discord.com", "discord.gg",
]);

function isBlockedDomain(domain: string): boolean {
  const d = normalizeDomain(domain);
  for (const blocked of BLOCKED_DOMAINS) {
    if (d === blocked || d.endsWith("." + blocked)) return true;
  }
  return false;
}

function getXmlTag(c: string, tag: string): string {
  const m = c.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function stripHtml(t: string): string {
  return t.replace(/<[^>]+>/g, " ").replace(/&[a-z0-9#]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** Unicode-safe normalization */
function normalizeText(t: string): string {
  return stripHtml(t).toLowerCase().replace(/[_\-–—]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function matchKeywords(text: string, keywords: string[]): string[] {
  const n = normalizeText(text);
  return keywords.filter(kw => n.includes(normalizeText(kw)));
}

function extractTitleFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
  } catch { return url; }
}

function parseSitemapIndex(xml: string): string[] {
  const urls: string[] = [];
  const re = /<sitemap>([\s\S]*?)<\/sitemap>/gi;
  let m; while ((m = re.exec(xml)) !== null) { const loc = getXmlTag(m[1], "loc"); if (loc) urls.push(loc); }
  return urls;
}

interface SitemapItem { title: string; url: string; snippet: string; published_at: string; source_domain: string; source_name: string; }

function parseSitemapItems(xml: string, domain: string, name: string): SitemapItem[] {
  const items: SitemapItem[] = [];
  const re = /<url>([\s\S]*?)<\/url>/gi;
  let m; while ((m = re.exec(xml)) !== null) {
    const url = getXmlTag(m[1], "loc"); if (!url) continue;
    const title = stripHtml(getXmlTag(m[1], "news:title") || extractTitleFromUrl(url)).slice(0, 220);
    const snippet = stripHtml(getXmlTag(m[1], "news:keywords")).slice(0, 500);
    const pubDate = getXmlTag(m[1], "news:publication_date") || getXmlTag(m[1], "lastmod");
    items.push({ title, url, snippet, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), source_domain: normalizeDomain(domain), source_name: name });
  }
  return items;
}

async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const resp = await fetchWithRetry(url, 25000, 2, `body scan ${url.slice(0, 50)}`);
    if (!resp?.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html")) { await resp.text(); return null; }
    const html = await resp.text();
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return (bodyMatch ? bodyMatch[1] : html)
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 10000);
  } catch { return null; }
}

async function analyzeSentimentBatch(items: { title: string; snippet: string }[], apiKey: string): Promise<{ sentiment: string; score: number }[]> {
  if (!items.length) return [];
  const prompt = items.map((it, i) => `[${i}] Title: ${it.title}\nSnippet: ${it.snippet}`).join("\n\n");
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", tools: [{ type: "function", function: { name: "classify_sentiments", description: "Classify sentiment", parameters: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "number" }, sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }, score: { type: "number" } }, required: ["index", "sentiment", "score"] } } }, required: ["results"] } } }], tool_choice: { type: "function", function: { name: "classify_sentiments" } }, messages: [{ role: "system", content: "Classify the sentiment of each news article." }, { role: "user", content: prompt }] }),
    });
    if (!r.ok) return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
    const d = JSON.parse(await r.text());
    const tc = d.choices?.[0]?.message?.tool_calls?.[0];
    if (tc?.function?.arguments) { const p = JSON.parse(tc.function.arguments); const res = p.results || []; return items.map((_, i) => { const x = res.find((r: any) => r.index === i); return x ? { sentiment: x.sentiment, score: x.score } : { sentiment: "neutral", score: 0.5 }; }); }
    return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
  } catch { return items.map(() => ({ sentiment: "neutral", score: 0.5 })); }
}

// ── Paginated fetch ──────────────────────────────────────

async function fetchAllRows(supabase: any, table: string, filters: Record<string, any>, orderBy?: { col: string; asc: boolean }): Promise<any[]> {
  const PAGE = 500;
  let all: any[] = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select("*");
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    if (orderBy) q = q.order(orderBy.col, { ascending: orderBy.asc });
    q = q.range(offset, offset + PAGE - 1);
    const { data } = await q;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── Main ─────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const maxDomains = Math.max(1, Number(body.max_domains || 20));
    const deepScanLimit = Math.max(0, Number(body.deep_scan_limit || 15));
    const domainOffset = Math.max(0, Number(body.offset || 0));

    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (!activeKeywords.length) return new Response(JSON.stringify({ discovered: 0, message: "No active keywords" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const searchTerms = activeKeywords.map((k: any) => k.text);
    const allSources = await fetchAllRows(supabase, "sources", { active: true });
    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls || []).map((a: any) => normalizeUrl(a.url)));

    // Fetch all approved domains, paginated, ordered by priority
    let allApprovedDomains: any[] = [];
    let dOffset = domainOffset;
    while (true) {
      const { data: batch } = await supabase.from("approved_domains").select("*").eq("active", true).eq("approval_status", "approved").order("priority", { ascending: false }).range(dOffset, dOffset + 499);
      if (!batch || batch.length === 0) break;
      allApprovedDomains = allApprovedDomains.concat(batch);
      if (batch.length < 500) break;
      dOffset += 500;
    }
    // Sort by priority descending so Tier 1 outlets are processed first
    allApprovedDomains.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));
    const domains = allApprovedDomains.slice(0, maxDomains);

    let discovered: { title: string; snippet: string; url: string; published_at: string; source_domain: string; source_name: string; matched_keywords: string[] }[] = [];
    let unmatchedForDeepScan: SitemapItem[] = [];

    for (const dom of (domains || [])) {
      const domain = normalizeDomain(dom.domain);
      const name = dom.name || domain;
      console.log(`Sitemap scanning ${domain}...`);

      // Discover sitemap URLs
      const sitemapUrls: string[] = [];
      if (dom.sitemap_url) sitemapUrls.push(dom.sitemap_url);
      try {
        const robotsResp = await fetchWithRetry(`https://${domain}/robots.txt`, 6000, 1, `robots ${domain}`);
        if (robotsResp?.ok) {
          const robotsTxt = await robotsResp.text();
          for (const line of robotsTxt.split(/\r?\n/)) {
            const match = line.match(/^Sitemap:\s*(.+)$/i);
            if (match?.[1] && !sitemapUrls.includes(match[1].trim())) sitemapUrls.push(match[1].trim());
          }
        }
      } catch {}
      // Fallback guesses
      for (const guess of [`https://${domain}/sitemap.xml`, `https://${domain}/news-sitemap.xml`, `https://${domain}/sitemap_index.xml`]) {
        if (!sitemapUrls.includes(guess)) sitemapUrls.push(guess);
      }

      let allItems: SitemapItem[] = [];
      for (const sitemapUrl of sitemapUrls.slice(0, 3)) {
        if (allItems.length >= 60) break;
        try {
          const resp = await fetchWithRetry(sitemapUrl, 15000, 2, `sitemap ${domain}`);
          if (!resp?.ok) { if (resp) await resp.text().catch(() => {}); continue; }
          const xml = await resp.text();

          if (/<sitemapindex/i.test(xml)) {
            const children = parseSitemapIndex(xml).slice(-2);
            for (const childUrl of children) {
              if (allItems.length >= 60) break;
              try {
                const childResp = await fetchWithRetry(childUrl, 15000, 1, `child sitemap ${domain}`);
                if (!childResp?.ok) { if (childResp) await childResp.text().catch(() => {}); continue; }
                const childXml = await childResp.text();
                allItems.push(...parseSitemapItems(childXml, domain, name).slice(-25));
              } catch {}
            }
          } else if (/<urlset/i.test(xml)) {
            allItems.push(...parseSitemapItems(xml, domain, name).slice(-30));
          }
        } catch {}
      }
      allItems = allItems.slice(0, 60);

      console.log(`${domain}: ${allItems.length} sitemap URLs found`);

      for (const item of allItems) {
        if (existingUrlSet.has(normalizeUrl(item.url))) continue;
        if (isBlockedDomain(item.source_domain)) continue;
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
    const keywordMatchUpdates: Record<string, number> = {};

    for (let b = 0; b < discovered.length; b += 10) {
      const batch = discovered.slice(b, b + 10);
      const toInsert = batch.map(a => {
        for (const kw of a.matched_keywords) { const k = activeKeywords.find((x: any) => x.text === kw); if (k) keywordMatchUpdates[k.id] = (keywordMatchUpdates[k.id] || 0) + 1; }
        const src = allSources.find((s: any) => normalizeDomain(s.domain || "") === normalizeDomain(a.source_domain));
        return {
          title: a.title, snippet: a.snippet.slice(0, 500), url: a.url,
          source_id: src?.id || null,
          source_name: a.source_name || null,
          source_domain: a.source_domain || null,
          published_at: a.published_at, fetched_at: new Date().toISOString(),
          matched_keywords: a.matched_keywords, language: null,
          sentiment: "neutral" as string, sentiment_score: 0.5,
        };
      });
      const sentiments = await analyzeSentimentBatch(toInsert.map(a => ({ title: a.title, snippet: a.snippet || "" })), lovableApiKey);
      toInsert.forEach((a, i) => { a.sentiment = sentiments[i].sentiment; a.sentiment_score = sentiments[i].score; });
      const { data: ins, error } = await supabase.from("articles").upsert(toInsert, { onConflict: "url", ignoreDuplicates: true }).select("id");
      if (error) console.error("Insert error:", error); else totalInserted += ins?.length || 0;
    }

    for (const [id, count] of Object.entries(keywordMatchUpdates)) {
      const kw = activeKeywords.find((k: any) => k.id === id);
      if (kw) await supabase.from("keywords").update({ match_count: kw.match_count + count }).eq("id", id);
    }

    const summary = { discovered: totalInserted, sitemapArticlesScanned: unmatchedForDeepScan.length, deepScanned: toScan.length, domainsScanned: (domains || []).length, domainOffset };
    console.log("Sitemap discovery complete:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("discover-sitemaps error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
