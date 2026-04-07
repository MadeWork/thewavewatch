import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const { topic_id, days_back: rawDays = 30 } = body
    const days_back = Math.min(Number(rawDays) || 30, 120)
    if (!topic_id) return json({ error: 'topic_id required' }, 400)

    const { data: topic } = await supabase.from('monitored_topics').select('*').eq('id', topic_id).single()
    if (!topic) return json({ error: 'Topic not found' }, 404)

    let keywords: string[] = []
    const raw = topic.keywords
    if (Array.isArray(raw)) keywords = raw.filter((k: any) => typeof k === 'string')
    else if (typeof raw === 'string') { try { keywords = JSON.parse(raw) } catch {} }
    if (!keywords.length) return json({ error: 'No keywords' }, 400)

    console.log(`Backfill: topic="${topic.name}", keywords=${JSON.stringify(keywords)}, days=${days_back}`)

    const fromDate = new Date(Date.now() - days_back * 24 * 60 * 60 * 1000)
    const fromDateStr = fromDate.toISOString().split('T')[0]
    const allArticles: any[] = []
    const sourceCounts: Record<string, number> = { guardian: 0, gdelt: 0, perigon: 0, google: 0, firecrawl: 0 }
    const errors: string[] = []

    const setEra = (pubDate: string | null) => {
      if (!pubDate) return 'archive'
      const ageDays = (Date.now() - new Date(pubDate).getTime()) / (1000 * 60 * 60 * 24)
      if (ageDays <= 7) return 'live'
      if (ageDays <= 30) return 'recent'
      return 'archive'
    }

    const makeArticle = (fields: any) => {
      const domain = fields.source_domain ?? extractDomainName(fields.url ?? '')
      const MAJOR = [
        'reuters.com','apnews.com','bloomberg.com','afp.com','nytimes.com','washingtonpost.com',
        'wsj.com','ft.com','cnbc.com','cnn.com','bbc.com','bbc.co.uk','theguardian.com',
        'euronews.com','euractiv.com','politico.eu','spiegel.de','dw.com','handelsblatt.com',
        'lemonde.fr','lefigaro.fr','elpais.com','heraldscotland.com','scotsman.com',
        'dn.se','svd.se','aftenposten.no','dn.no','carbonbrief.org','energymonitor.ai',
        'abc.net.au','smh.com.au','nzherald.co.nz','stuff.co.nz','rnz.co.nz',
      ]
      return {
        source_category: 'media',
        is_duplicate: false,
        ...fields,
        source_domain: domain,
        matched_keywords: fields.matched_keywords ?? keywords,
        is_major_outlet: MAJOR.some(m => (domain || '').includes(m)),
        articles_era: setEra(fields.published_at),
      }
    }

    // GUARDIAN
    const guardianKey = Deno.env.get('GUARDIAN_API_KEY')
    if (guardianKey) {
      try {
        const query = keywords.map((k: string) => k.includes(' ') ? `"${k}"` : k).join(' OR ')
        const url = new URL('https://content.guardianapis.com/search')
        url.searchParams.set('q', query)
        url.searchParams.set('from-date', fromDateStr)
        url.searchParams.set('order-by', 'relevance')
        url.searchParams.set('show-fields', 'headline,trailText,byline,thumbnail')
        url.searchParams.set('page-size', '50')
        url.searchParams.set('api-key', guardianKey)
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
        if (res.ok) {
          const data = await res.json()
          const articles = (data.response?.results ?? []).map((a: any) => makeArticle({
            external_id: hashUrl(a.webUrl), topic_id: topic.id, user_id: topic.user_id,
            source_name: 'The Guardian', source_url: 'theguardian.com',
            title: a.fields?.headline ?? a.webTitle, description: a.fields?.trailText ?? null,
            author: a.fields?.byline ?? null, published_at: a.webPublicationDate,
            url: a.webUrl, image_url: a.fields?.thumbnail ?? null,
            language: 'en', media_type: 'web', ingestion_source: 'guardian-backfill',
          }))
          allArticles.push(...articles)
          sourceCounts.guardian = articles.length
          console.log(`Guardian: ${articles.length} results`)
        } else {
          console.error(`Guardian: HTTP ${res.status}`)
          errors.push(`Guardian: HTTP ${res.status}`)
        }
      } catch (err: any) { console.error('Guardian:', err.message); errors.push(`Guardian: ${err.message}`) }
    }

    // GDELT
    try {
      const gdeltQuery = keywords.slice(0, 3).join(' ')
      const startDt = fromDate.toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const endDt = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(gdeltQuery)}&mode=artlist&maxrecords=100&format=json&startdatetime=${startDt}&enddatetime=${endDt}`, { signal: AbortSignal.timeout(15000) })
      if (res.ok) {
        const data = await res.json()
        const articles = (data.articles ?? []).filter((a: any) => a.title && a.url).map((a: any) => {
          const pub = parseGDELTDate(a.seendate)
          return makeArticle({
            external_id: hashUrl(a.url), topic_id: topic.id, user_id: topic.user_id,
            source_name: a.domain ?? 'Unknown', source_url: a.domain ?? '',
            title: a.title, description: null, author: null, published_at: pub,
            url: a.url, image_url: null, language: a.language ?? 'en',
            media_type: 'web', ingestion_source: 'gdelt-backfill',
          })
        })
        allArticles.push(...articles)
        sourceCounts.gdelt = articles.length
        console.log(`GDELT: ${articles.length} results`)
      } else {
        console.error(`GDELT: HTTP ${res.status}`)
        errors.push(`GDELT: HTTP ${res.status}`)
      }
    } catch (err: any) { console.error('GDELT:', err.message); errors.push(`GDELT: ${err.message}`) }

    // PERIGON
    const perigonKey = Deno.env.get('PERIGON_API_KEY')
    if (perigonKey) {
      try {
        const query = keywords.map((k: string) => k.includes(' ') ? `"${k}"` : k).join(' OR ')
        const url = new URL('https://api.goperigon.com/v1/all')
        url.searchParams.set('q', query)
        url.searchParams.set('from', fromDate.toISOString())
        url.searchParams.set('sortBy', 'relevance')
        url.searchParams.set('showReprints', 'false')
        url.searchParams.set('size', '50')
        url.searchParams.set('apiKey', perigonKey)
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
        if (res.ok) {
          const data = await res.json()
          const articles = (data.articles ?? []).filter((a: any) => a.title && a.url).map((a: any) => makeArticle({
            external_id: hashUrl(a.url), topic_id: topic.id, user_id: topic.user_id,
            source_name: a.source?.name ?? a.source?.domain ?? 'Unknown',
            source_url: a.source?.domain ?? '', title: a.title,
            description: a.description ?? a.summary ?? null,
            author: a.authorsByline ?? null,
            published_at: a.pubDate ?? a.addDate ?? new Date().toISOString(),
            url: a.url, image_url: a.imageUrl ?? null,
            language: a.language ?? 'en', media_type: 'web', ingestion_source: 'perigon-backfill',
          }))
          allArticles.push(...articles)
          sourceCounts.perigon = articles.length
          console.log(`Perigon: ${articles.length} results`)
        } else {
          console.error(`Perigon: HTTP ${res.status}`)
          errors.push(`Perigon: HTTP ${res.status}`)
        }
      } catch (err: any) { console.error('Perigon:', err.message); errors.push(`Perigon: ${err.message}`) }
    }

    // GOOGLE NEWS
    try {
      const gnQuery = keywords.slice(0, 3).map((k: string) => k.includes(' ') ? `"${k}"` : k).join(' OR ')
      const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(gnQuery)}&hl=en&gl=GB&ceid=GB:en`, {
        headers: { 'User-Agent': 'WaveWatch/1.0 media monitoring' },
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const xml = await res.text()
        const items = parseRSSXML(xml)
        const articles = items.filter((item: any) => item.title && item.link).map((item: any) => {
          // Google News titles often end with " - Source Name"
          const titleParts = (item.title ?? '').split(' - ')
          const sourceName = titleParts.length > 1 ? titleParts[titleParts.length - 1].trim() : ''
          return makeArticle({
            external_id: hashUrl(item.link ?? ''), topic_id: topic.id, user_id: topic.user_id,
            source_name: sourceName || 'Google News',
            source_url: '',
            title: titleParts.length > 1 ? titleParts.slice(0, -1).join(' - ').trim() : item.title,
            description: item.description ?? null, author: null,
            published_at: item.pubDate ?? new Date().toISOString(),
            url: item.link, image_url: null, language: 'en',
            media_type: 'web', ingestion_source: 'google-news-backfill',
          })
        })
        allArticles.push(...articles)
        sourceCounts.google = articles.length
        console.log(`Google News: ${articles.length} results`)
      } else {
        errors.push(`Google News: HTTP ${res.status}`)
      }
    } catch (err: any) { console.error('Google News:', err.message); errors.push(`Google News: ${err.message}`) }

    // FIRECRAWL — site-restricted deep search across major outlets
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (firecrawlKey) {
      const MAJOR_OUTLETS = [
        // UK majors
        'bbc.co.uk', 'bbc.com', 'theguardian.com', 'ft.com', 'telegraph.co.uk',
        'independent.co.uk', 'thetimes.co.uk', 'sky.com',
        'heraldscotland.com', 'scotsman.com', 'pressandjournal.co.uk',
        // European majors
        'reuters.com', 'euronews.com', 'politico.eu', 'spiegel.de', 'lemonde.fr',
        'lefigaro.fr', 'dw.com', 'handelsblatt.com', 'euractiv.com', 'elpais.com',
        'corriere.it', 'repubblica.it', 'lecho.be',
        'dn.se', 'svd.se', 'aftenposten.no', 'dn.no',
        'berlingske.dk', 'politiken.dk', 'yle.fi',
        'thelocal.com', 'rte.ie', 'irishtimes.com',
        // US majors
        'nytimes.com', 'washingtonpost.com', 'bloomberg.com', 'cnbc.com',
        'forbes.com', 'wsj.com', 'apnews.com',
        // ANZ
        'abc.net.au', 'smh.com.au', 'nzherald.co.nz', 'stuff.co.nz',
        // Key energy/climate
        'carbonbrief.org', 'energymonitor.ai', 'rechargenews.com',
        'renewableenergyworld.com', 'offshore-energy.biz',
      ]

      // Build site-restricted queries: one per keyword, batching sites
      const siteFilter = MAJOR_OUTLETS.map(d => `site:${d}`).join(' OR ')
      const fcQueries = keywords.slice(0, 4).map((k: string) => ({
        query: `"${k}" (${siteFilter})`,
        keyword: k,
      }))

      for (const fq of fcQueries) {
        try {
          const res = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: fq.query, limit: 5 }),
            signal: AbortSignal.timeout(15000),
          })
          if (res.ok) {
            const data = await res.json()
            const results = data.data || data.results || []
            const articles = results
              .filter((r: any) => r.url && r.title && !isBlockedUrl(r.url))
              .map((r: any) => makeArticle({
                external_id: hashUrl(r.url), topic_id: topic.id, user_id: topic.user_id,
                source_name: r.metadata?.ogSiteName || extractDomainName(r.url),
                source_url: extractDomainName(r.url),
                source_domain: extractDomainName(r.url),
                title: r.title, description: r.description || r.metadata?.description || null,
                author: r.metadata?.author || null,
                published_at: r.metadata?.publishedTime || r.metadata?.ogArticlePublishedTime || null,
                url: r.url, image_url: r.metadata?.ogImage || null,
                language: r.metadata?.language?.split('-')[0] || 'en',
                media_type: 'web', ingestion_source: 'firecrawl-backfill',
                matched_keywords: [fq.keyword],
                discovery_method: 'firecrawl',
              }))
            allArticles.push(...articles)
            sourceCounts.firecrawl += articles.length
            console.log(`Firecrawl "${fq.keyword}": ${articles.length} results`)
          } else if (res.status === 402) {
            console.warn('Firecrawl credits exhausted — stopping Firecrawl searches')
            break
          } else {
            const errBody = await res.text().catch(() => '')
            console.error(`Firecrawl "${fq.keyword}": HTTP ${res.status} ${errBody}`)
            errors.push(`Firecrawl: HTTP ${res.status}`)
          }
        } catch (err: any) {
          console.error(`Firecrawl "${fq.keyword}":`, err.message)
          errors.push(`Firecrawl: ${err.message}`)
        }
      }
      console.log(`Firecrawl total: ${sourceCounts.firecrawl} results`)
    }

    console.log(`Total found: ${allArticles.length}`)

    if (!allArticles.length) return json({ inserted: 0, found: 0, sources: sourceCounts, errors })

    // Resolve Google News redirect URLs to actual publisher URLs
    const gnArticles = allArticles.filter(a => a.url?.includes('news.google.com'))
    if (gnArticles.length) {
      console.log(`Resolving ${gnArticles.length} Google News URLs...`)
      await Promise.allSettled(gnArticles.map(async (a) => {
        const resolved = await resolveGoogleNewsUrl(a.url)
        if (resolved !== a.url) {
          a.url = resolved
          a.source_domain = extractDomainName(resolved)
          a.source_name = extractDomainName(resolved)
          a.external_id = hashUrl(resolved)
        }
      }))
    }

    // Dedupe by URL
    const seen = new Set<string>()
    const deduped = allArticles.filter(a => {
      if (!a.url || seen.has(a.url)) return false
      seen.add(a.url)
      return true
    })

    // Insert in batches of 50 to avoid timeouts
    let insertedCount = 0
    for (let i = 0; i < deduped.length; i += 50) {
      const batch = deduped.slice(i, i + 50)
      const { data: ins, error: insertError } = await supabase
        .from('articles')
        .upsert(batch, { onConflict: 'url', ignoreDuplicates: true })
        .select('id')
      if (insertError) {
        console.error(`Insert batch ${i}: ${insertError.message}`)
        errors.push(`DB: ${insertError.message}`)
      } else {
        insertedCount += ins?.length ?? 0
      }
    }

    console.log(`Inserted: ${insertedCount}`)
    return json({ inserted: insertedCount, found: allArticles.length, days_back, sources: sourceCounts, errors: errors.length ? errors : undefined })
  } catch (err: any) {
    console.error('Backfill error:', err.message)
    return json({ error: err.message }, 500)
  }
})

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
function hashUrl(url: string): string { let h = 0; for (let i = 0; i < url.length; i++) { h = ((h << 5) - h) + url.charCodeAt(i); h |= 0 } return Math.abs(h).toString(36) }
function parseGDELTDate(d: string): string { if (!d || d.length < 14) return new Date().toISOString(); return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(8,10)}:${d.slice(10,12)}:${d.slice(12,14)}Z` }
function extractDomainName(url: string): string { try { return new URL(url).hostname.replace('www.', '') } catch { return url } }
function isBlockedUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace('www.', '').toLowerCase()
    const blocked = ['facebook.com','twitter.com','x.com','instagram.com','linkedin.com','youtube.com','reddit.com','tiktok.com','pinterest.com']
    return blocked.some(d => h === d || h.endsWith('.' + d))
  } catch { return false }
}
async function resolveGoogleNewsUrl(gnUrl: string): Promise<string> {
  if (!gnUrl.includes('news.google.com')) return gnUrl
  try {
    const resp = await fetch(gnUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WaveWatch/1.0)' }, signal: AbortSignal.timeout(5000) })
    const finalUrl = resp.url
    await resp.text().catch(() => {})
    if (finalUrl && !finalUrl.includes('news.google.com') && !finalUrl.includes('consent.google.com')) return finalUrl
    return gnUrl
  } catch { return gnUrl }
}
function parseRSSXML(xml: string): any[] {
  const items: any[] = []
  const isAtom = xml.includes('<feed') && xml.includes('xmlns')
  if (isAtom) {
    for (const m of xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)) {
      const e = m[1]
      items.push({ title: extractXMLText(e,'title'), link: extractXMLAttr(e,'link','href') ?? extractXMLText(e,'link'), description: extractXMLText(e,'summary') ?? extractXMLText(e,'content'), pubDate: extractXMLText(e,'published') ?? extractXMLText(e,'updated'), guid: extractXMLText(e,'id') })
    }
  } else {
    for (const m of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)) {
      const i = m[1]
      items.push({ title: extractXMLText(i,'title'), link: extractXMLText(i,'link'), description: extractXMLText(i,'description'), pubDate: extractXMLText(i,'pubDate') ?? extractXMLText(i,'dc:date'), guid: extractXMLText(i,'guid') })
    }
  }
  return items.filter(i => i.title && (i.link || i.guid))
}
function extractXMLText(xml: string, tag: string): string | null {
  const c = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
  if (c) return c[1].trim()
  const t = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (t) return t[1].replace(/<[^>]+>/g, '').trim() || null
  return null
}
function extractXMLAttr(xml: string, tag: string, attr: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'))
  return m ? m[1] : null
}
