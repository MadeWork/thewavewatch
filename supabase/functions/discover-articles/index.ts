import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Types ────────────────────────────────────────────────

interface DiscoveredArticle {
  title: string;
  snippet: string;
  url: string;
  published_at: string;
  source_domain: string;
  source_name: string;
  matched_keywords: string[];
  language?: string | null;
}

interface RSSItem {
  title: string;
  url: string;
  snippet: string;
  published_at: string;
  source_domain: string;
  source_name: string;
}

// ── Utilities ────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
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

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/&[a-z0-9#]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** Unicode-safe text normalization for keyword matching */
function normalizeText(text: string): string {
  return stripHtml(text)
    .toLowerCase()
    .replace(/[_\-–—]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "oc", "ref", "fbclid", "gclid"].forEach(p => parsed.searchParams.delete(p));
    parsed.hash = "";
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch { return url; }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())).map(v => v.trim()))];
}

function getXmlTag(content: string, tag: string): string {
  const m = content.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

/** Unicode-safe keyword matching */
function matchKeywords(text: string, keywords: string[]): string[] {
  const n = normalizeText(text);
  return keywords.filter(kw => n.includes(normalizeText(kw)));
}

/** Try to extract a publication date from a URL path like /2024/03/15/ */
function extractDateFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//);
    if (m) {
      const d = new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T12:00:00Z`);
      if (!isNaN(d.getTime()) && d.getTime() > new Date("2000-01-01").getTime()) return d.toISOString();
    }
  } catch {}
  return null;
}

function extractTitleFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
  } catch { return url; }
}

function looksLikeArticleUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const last = path.split("/").filter(Boolean).pop() || "";
    return /\/\d{4}\/\d{2}\//.test(path) || /\d{5,}/.test(last) || last.split(/[-_]+/).length >= 4;
  } catch { return false; }
}

/** Detect language from HTML or feed metadata */
function detectLanguage(html: string): string | null {
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  if (langMatch) return langMatch[1].split("-")[0].toLowerCase();
  const metaLang = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+http-equiv=["']content-language["']/i)
    || html.match(/<meta[^>]+http-equiv=["']content-language["'][^>]+content=["']([^"']+)["']/i);
  if (metaLang) return (metaLang[1] || metaLang[2] || "").split("-")[0].toLowerCase();
  return null;
}

// ── Parsers ──────────────────────────────────────────────

function parseRSSItems(xml: string, domain: string, sourceName: string): RSSItem[] {
  const items: RSSItem[] = [];
  const nd = normalizeDomain(domain);

  // RSS <item>
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getXmlTag(c, "title");
    const link = getXmlTag(c, "link") || getXmlTag(c, "guid");
    const desc = stripHtml(getXmlTag(c, "description")).slice(0, 500);
    const pubDate = getXmlTag(c, "pubDate") || getXmlTag(c, "dc:date");
    if (title && link) items.push({ title, url: link, snippet: desc, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), source_domain: nd, source_name: sourceName });
  }

  // Atom <entry>
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((m = entryRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getXmlTag(c, "title");
    const linkMatch = c.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : getXmlTag(c, "link");
    const summary = stripHtml(getXmlTag(c, "summary") || getXmlTag(c, "content")).slice(0, 500);
    const updated = getXmlTag(c, "updated") || getXmlTag(c, "published");
    if (title && link) items.push({ title, url: link, snippet: summary, published_at: updated ? new Date(updated).toISOString() : new Date().toISOString(), source_domain: nd, source_name: sourceName });
  }
  return items;
}

function parseGoogleNewsRSS(xml: string, keyword: string): DiscoveredArticle[] {
  const articles: DiscoveredArticle[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const c = m[1];
    const title = getXmlTag(c, "title");
    const gnLink = getXmlTag(c, "link");
    const desc = stripHtml(getXmlTag(c, "description")).slice(0, 500);
    const pubDate = getXmlTag(c, "pubDate");
    const srcMatch = c.match(/<source[^>]+url=["']([^"']+)["'][^>]*>(.*?)<\/source>/i);
    if (title && gnLink) {
      let domain = "";
      try { domain = normalizeDomain(srcMatch ? srcMatch[1] : gnLink); } catch {}
      articles.push({
        title, snippet: desc, url: gnLink,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source_domain: domain, source_name: srcMatch ? stripHtml(srcMatch[2]) : domain,
        matched_keywords: [keyword],
      });
    }
  }
  return articles;
}

/** Fetch article body text for deep scanning */
async function fetchArticleText(url: string): Promise<{ text: string; lang: string | null } | null> {
  try {
    const resp = await fetchWithTimeout(url, 6000);
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) { await resp.text(); return null; }
    const html = await resp.text();
    const lang = detectLanguage(html);
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const cleaned = (bodyMatch ? bodyMatch[1] : html)
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
    return { text: cleaned.slice(0, 12000), lang };
  } catch { return null; }
}

// ── Sentiment ────────────────────────────────────────────

async function analyzeSentimentBatch(items: { title: string; snippet: string }[], apiKey: string): Promise<{ sentiment: string; score: number }[]> {
  if (!items.length) return [];
  const prompt = items.map((it, i) => `[${i}] Title: ${it.title}\nSnippet: ${it.snippet}`).join("\n\n");
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        tools: [{ type: "function", function: { name: "classify_sentiments", description: "Classify sentiment", parameters: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "number" }, sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }, score: { type: "number" } }, required: ["index", "sentiment", "score"] } } }, required: ["results"] } } }],
        tool_choice: { type: "function", function: { name: "classify_sentiments" } },
        messages: [{ role: "system", content: "Classify the sentiment of each news article." }, { role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
    const d = JSON.parse(await r.text());
    const tc = d.choices?.[0]?.message?.tool_calls?.[0];
    if (tc?.function?.arguments) {
      const p = JSON.parse(tc.function.arguments);
      const res = p.results || [];
      return items.map((_, i) => { const x = res.find((r: any) => r.index === i); return x ? { sentiment: x.sentiment, score: x.score } : { sentiment: "neutral", score: 0.5 }; });
    }
    return items.map(() => ({ sentiment: "neutral", score: 0.5 }));
  } catch { return items.map(() => ({ sentiment: "neutral", score: 0.5 })); }
}

// ── Paginated query helper ───────────────────────────────

async function fetchAllRows(supabase: any, table: string, filters: Record<string, any>, orderBy?: { col: string; asc: boolean }): Promise<any[]> {
  const PAGE = 500;
  let all: any[] = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select("*");
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    if (orderBy) q = q.order(orderBy.col, { ascending: orderBy.asc });
    q = q.range(offset, offset + PAGE - 1);
    const { data, error } = await q;
    if (error) { console.error(`fetchAllRows ${table} error:`, error); break; }
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
    const deepScanLimit = Math.max(0, Number(body.deep_scan_limit ?? 20));
    const debug = Boolean(body.debug);

    const { data: keywords } = await supabase.from("keywords").select("*").eq("active", true);
    const activeKeywords = keywords || [];
    if (!activeKeywords.length) return new Response(JSON.stringify({ discovered: 0, message: "No active keywords" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: settings } = await supabase.from("settings").select("company_name").limit(1).maybeSingle();
    const searchTerms = uniqueStrings([
      ...activeKeywords.map(k => k.text),
      settings?.company_name && settings.company_name !== "My Company" ? settings.company_name : undefined,
    ]);

    // Fetch ALL existing URLs for dedup
    const { data: existingUrls } = await supabase.from("articles").select("url").limit(5000);
    const existingUrlSet = new Set((existingUrls || []).map((a: any) => normalizeUrl(a.url)));

    // Fetch ALL sources (no hard limit)
    const allSources = await fetchAllRows(supabase, "sources", { active: true });
    const sourceMap = new Map(allSources.map((s: any) => [s.id, s]));

    // Fetch ALL approved domains (no hard limit)
    const allDomains = await fetchAllRows(supabase, "approved_domains", { active: true, approval_status: "approved" }, { col: "priority", asc: false });

    let allDiscovered: DiscoveredArticle[] = [];
    let allUnmatched: RSSItem[] = [];
    const logs: string[] = [];

    // ── Step 1: Google News RSS ──────────────────────────
    console.log(`Searching Google News for ${searchTerms.length} keywords...`);
    for (const term of searchTerms) {
      try {
        const q = encodeURIComponent(term);
        const url = `https://news.google.com/rss/search?q=${q}&hl=en&gl=US&ceid=US:en`;
        const resp = await fetchWithTimeout(url, 8000);
        if (resp.ok) {
          const xml = await resp.text();
          const articles = parseGoogleNewsRSS(xml, term);
          logs.push(`Google News "${term}": ${articles.length} articles`);
          console.log(`Google News "${term}": ${articles.length} articles`);
          allDiscovered.push(...articles);
        } else {
          logs.push(`Google News "${term}": HTTP ${resp.status}`);
          console.warn(`Google News "${term}": HTTP ${resp.status}`);
        }
        await new Promise(r => setTimeout(r, 800));
      } catch (e: any) {
        logs.push(`Google News "${term}" error: ${e.message}`);
        console.error(`Google News "${term}" error:`, e.message);
      }
    }

    // ── Step 2: Approved domain feeds ────────────────────
    const domainsWithFeeds = allDomains.filter((d: any) => d.feed_url);
    if (domainsWithFeeds.length > 0) {
      console.log(`Scanning ${domainsWithFeeds.length} approved domain feeds...`);
      const CONC = 5;
      for (let i = 0; i < domainsWithFeeds.length; i += CONC) {
        const batch = domainsWithFeeds.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async (dom: any) => {
          try {
            const resp = await fetchWithTimeout(dom.feed_url, 8000);
            if (!resp.ok) { logs.push(`Feed ${dom.name}: HTTP ${resp.status}`); return { matched: [], unmatched: [] }; }
            const xml = await resp.text();
            const items = parseRSSItems(xml, dom.domain, dom.name);
            const matched: DiscoveredArticle[] = [];
            const unmatched: RSSItem[] = [];
            for (const item of items) {
              const kws = matchKeywords(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
              if (kws.length > 0) matched.push({ ...item, matched_keywords: kws });
              else unmatched.push(item);
            }
            logs.push(`Feed ${dom.name}: ${items.length} items, ${matched.length} matched`);
            if (debug && items.length > 0) console.log(`Feed ${dom.name} sample titles:`, items.slice(0, 3).map(i => i.title));
            return { matched, unmatched };
          } catch { return { matched: [], unmatched: [] }; }
        }));
        for (const r of results) {
          if (r.status === "fulfilled") { allDiscovered.push(...r.value.matched); allUnmatched.push(...r.value.unmatched); }
        }
        if (i + CONC < domainsWithFeeds.length) await new Promise(r => setTimeout(r, 200));
      }
    }

    // ── Step 3: Active source feeds (ALL, no limit) ──────
    if (allSources.length > 0) {
      console.log(`Scanning ${allSources.length} active source feeds...`);
      const CONC = 5;
      for (let i = 0; i < allSources.length; i += CONC) {
        const batch = allSources.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async (src: any) => {
          try {
            const resp = await fetchWithTimeout(src.rss_url, 8000);
            if (!resp.ok) { logs.push(`Source ${src.name}: HTTP ${resp.status}`); return { matched: [], unmatched: [] }; }
            const xml = await resp.text();
            const domain = src.domain || normalizeDomain(new URL(src.rss_url).hostname);
            const items = parseRSSItems(xml, domain, src.name);
            const matched: DiscoveredArticle[] = [];
            const unmatched: RSSItem[] = [];
            for (const item of items) {
              const kws = matchKeywords(`${item.title} ${item.snippet} ${item.url}`, searchTerms);
              if (kws.length > 0) matched.push({ ...item, matched_keywords: kws });
              else unmatched.push(item);
            }
            logs.push(`Source ${src.name}: ${items.length} items, ${matched.length} matched`);
            return { matched, unmatched };
          } catch { return { matched: [], unmatched: [] }; }
        }));
        for (const r of results) {
          if (r.status === "fulfilled") { allDiscovered.push(...r.value.matched); allUnmatched.push(...r.value.unmatched); }
        }
        if (i + CONC < allSources.length) await new Promise(r => setTimeout(r, 200));
      }
    }

    // ── Step 4: Deep scan unmatched article bodies ───────
    let deepScanned = 0;
    if (deepScanLimit > 0 && allUnmatched.length > 0) {
      // Prioritize: recent articles and high-priority domains
      const priorityDomains = new Set(allDomains.filter((d: any) => (d.priority || 0) >= 70).map((d: any) => normalizeDomain(d.domain)));
      const sortedUnmatched = allUnmatched
        .filter(item => !existingUrlSet.has(normalizeUrl(item.url)))
        .sort((a, b) => {
          const aPri = priorityDomains.has(normalizeDomain(a.source_domain)) ? 1 : 0;
          const bPri = priorityDomains.has(normalizeDomain(b.source_domain)) ? 1 : 0;
          if (aPri !== bPri) return bPri - aPri;
          return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
        })
        .slice(0, deepScanLimit);

      console.log(`Deep scanning ${sortedUnmatched.length} article bodies...`);
      const CONC = 3;
      for (let i = 0; i < sortedUnmatched.length; i += CONC) {
        const batch = sortedUnmatched.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(async item => {
          deepScanned++;
          const result = await fetchArticleText(item.url);
          if (!result) return null;
          const kws = matchKeywords(result.text, searchTerms);
          if (kws.length > 0) {
            return { ...item, matched_keywords: kws, language: result.lang } as DiscoveredArticle;
          }
          return null;
        }));
        for (const r of results) { if (r.status === "fulfilled" && r.value) allDiscovered.push(r.value); }
      }
    }

    // ── Dedup ────────────────────────────────────────────
    console.log(`Total candidates before dedup: ${allDiscovered.length}`);
    const seen = new Set<string>();
    allDiscovered = allDiscovered.filter(a => {
      const n = normalizeUrl(a.url);
      if (seen.has(n) || existingUrlSet.has(n)) return false;
      seen.add(n); return true;
    });
    console.log(`After dedup: ${allDiscovered.length} new articles`);

    // ── Auto-discover new domains ────────────────────────
    const knownDomains = new Set([
      ...allSources.map((s: any) => normalizeDomain(s.domain || "")),
      ...allDomains.map((d: any) => normalizeDomain(d.domain)),
    ]);
    const newDomains = new Map<string, { name: string; count: number }>();
    for (const a of allDiscovered) {
      if (a.source_domain) {
        const key = normalizeDomain(a.source_domain);
        if (!knownDomains.has(key)) {
          const ex = newDomains.get(key);
          if (ex) ex.count++; else newDomains.set(key, { name: a.source_name, count: 1 });
        }
      }
    }
    if (newDomains.size > 0) {
      const candidates = Array.from(newDomains.entries()).map(([domain, info]) => ({
        domain, name: info.name || domain, approval_status: "pending", auto_discovered: true, active: false, priority: 30,
      }));
      const { data: existingDoms } = await supabase.from("approved_domains").select("domain").in("domain", candidates.map(c => c.domain));
      const existSet = new Set((existingDoms || []).map((d: any) => normalizeDomain(d.domain)));
      const trulyNew = candidates.filter(c => !existSet.has(normalizeDomain(c.domain)));
      if (trulyNew.length > 0) {
        await supabase.from("approved_domains").insert(trulyNew);
        console.log(`Auto-discovered ${trulyNew.length} new domains`);
      }
    }

    // ── Insert ───────────────────────────────────────────
    let totalInserted = 0;
    const keywordMatchUpdates: Record<string, number> = {};
    const BATCH = 10;

    for (let b = 0; b < allDiscovered.length; b += BATCH) {
      const batch = allDiscovered.slice(b, b + BATCH);
      const toInsert = batch.map(a => {
        for (const kw of a.matched_keywords) {
          const k = activeKeywords.find((x: any) => x.text === kw);
          if (k) keywordMatchUpdates[k.id] = (keywordMatchUpdates[k.id] || 0) + 1;
        }
        const matchedSource = allSources.find((s: any) =>
          normalizeDomain(s.domain || "") === normalizeDomain(a.source_domain)
          || (s.rss_url && normalizeDomain(new URL(s.rss_url).hostname) === normalizeDomain(a.source_domain))
        );
        return {
          title: a.title, snippet: a.snippet.slice(0, 500), url: a.url,
          source_id: matchedSource?.id || null,
          source_name: a.source_name || null,
          source_domain: a.source_domain || null,
          published_at: a.published_at, fetched_at: new Date().toISOString(),
          matched_keywords: a.matched_keywords,
          language: a.language || null,
          sentiment: "neutral" as string, sentiment_score: 0.5,
        };
      });

      const sentiments = await analyzeSentimentBatch(toInsert.map(a => ({ title: a.title, snippet: a.snippet || "" })), lovableApiKey);
      toInsert.forEach((a, i) => { a.sentiment = sentiments[i].sentiment; a.sentiment_score = sentiments[i].score; });

      const { data: ins, error } = await supabase.from("articles").upsert(toInsert, { onConflict: "url", ignoreDuplicates: true }).select("id");
      if (error) console.error("Insert error:", error);
      else totalInserted += ins?.length || 0;
    }

    for (const [id, count] of Object.entries(keywordMatchUpdates)) {
      const kw = activeKeywords.find((k: any) => k.id === id);
      if (kw) await supabase.from("keywords").update({ match_count: kw.match_count + count }).eq("id", id);
    }

    const summary = {
      discovered: totalInserted,
      totalCandidates: allDiscovered.length,
      deepScanned,
      newDomainsFound: newDomains.size,
      sourcesScanned: allSources.length,
      domainsScanned: allDomains.length,
      keywordsUsed: searchTerms,
      methods: ["google_news_rss", "approved_domain_feeds", "source_feeds", deepScanLimit > 0 ? "deep_scan" : null].filter(Boolean),
    };
    console.log("Discovery complete:", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("discover-articles error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
