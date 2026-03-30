import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ─── KEYWORD EXPANSION ──────────────────────────────────────────────────────

const KEYWORD_EXPANSIONS: Record<string, string[]> = {
  'marine energy':      ['wave energy', 'wave power', 'tidal energy', 'tidal power', 'ocean energy', 'ocean power', 'offshore energy', 'WEC', 'wave energy converter'],
  'wave energy':        ['wave power', 'marine energy', 'ocean energy', 'tidal energy', 'WEC', 'offshore renewables'],
  'wave power':         ['wave energy', 'marine energy', 'ocean energy', 'tidal power'],
  'tidal energy':       ['tidal power', 'marine energy', 'ocean energy', 'tidal stream', 'tidal current'],
  'offshore wind':      ['offshore wind farm', 'offshore wind turbine', 'floating wind', 'wind farm'],
  'renewable energy':   ['clean energy', 'green energy', 'clean power', 'green power', 'decarbonisation', 'net zero energy'],
  'carbon capture':     ['CCS', 'CCUS', 'carbon sequestration', 'carbon storage', 'net zero'],
  'electric vehicle':   ['EV', 'electric car', 'battery vehicle', 'EV charging'],
  'artificial intelligence': ['AI', 'machine learning', 'generative AI', 'large language model', 'LLM'],
  'climate change':     ['global warming', 'climate crisis', 'net zero', 'carbon emissions', 'greenhouse gas'],
}

function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set<string>()

  for (const kw of keywords) {
    expanded.add(kw)
    const lower = kw.toLowerCase()

    if (KEYWORD_EXPANSIONS[lower]) {
      for (const syn of KEYWORD_EXPANSIONS[lower]) {
        expanded.add(syn)
      }
    }

    for (const [key, syns] of Object.entries(KEYWORD_EXPANSIONS)) {
      if (lower.includes(key) && lower !== key) {
        for (const syn of syns) expanded.add(syn)
      }
    }
  }

  return Array.from(expanded)
}

function buildPerigonQuery(keywords: string[]): string {
  const expanded = expandKeywords(keywords)

  return expanded
    .map(k => {
      const trimmed = k.trim()
      if (!trimmed.includes(' ')) return trimmed
      return `"${trimmed}"`
    })
    .join(' OR ')
}

// ─── MAJOR OUTLET DOMAINS ────────────────────────────────────────────────────

const MAJOR_OUTLET_DOMAINS = [
  // Wire services
  'reuters.com', 'apnews.com', 'bloomberg.com', 'afp.com',
  // US majors
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com',
  'cnbc.com', 'cnn.com', 'nbcnews.com', 'abcnews.go.com',
  'cbsnews.com', 'npr.org', 'politico.com', 'theatlantic.com',
  'time.com', 'forbes.com', 'usatoday.com', 'latimes.com',
  'businessinsider.com',
  // UK majors
  'theguardian.com', 'bbc.com', 'bbc.co.uk', 'thetimes.co.uk',
  'telegraph.co.uk', 'independent.co.uk', 'sky.com', 'standard.co.uk',
  // Nordic
  'dn.se', 'svd.se', 'di.se', 'aftonbladet.se', 'expressen.se',
  'aftenposten.no', 'dn.no', 'vg.no', 'nrk.no', 'e24.no',
  'berlingske.dk', 'politiken.dk', 'borsen.dk', 'dr.dk',
  'yle.fi', 'hs.fi',
  // European majors
  'spiegel.de', 'faz.net', 'sueddeutsche.de', 'dw.com',
  'lemonde.fr', 'lefigaro.fr', 'euractiv.com', 'politico.eu',
  // Australia
  'abc.net.au', 'smh.com.au', 'theage.com.au', 'afr.com',
  'theaustralian.com.au', 'news.com.au', 'sbs.com.au',
  // New Zealand
  'nzherald.co.nz', 'stuff.co.nz', 'rnz.co.nz', 'newsroom.co.nz',
]

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { topic_id } = await req.json().catch(() => ({}))

    const query = supabase
      .from('monitored_topics')
      .select('*')
      .eq('is_active', true)

    if (topic_id) query.eq('id', topic_id)

    const { data: topics, error } = await query
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!topics || topics.length === 0) {
      return new Response(JSON.stringify({ results: [], message: 'No active topics found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results = []

    for (const topic of topics) {
      // Safety: skip topics with no keywords
      if (!topic.keywords?.length) {
        console.warn(`Topic "${topic.name}" has no keywords — skipping`)
        continue
      }
      for (const source of topic.sources ?? ['perigon', 'guardian', 'gdelt']) {
        const runId = crypto.randomUUID()

        await supabase.from('ingestion_runs').insert({
          id: runId,
          topic_id: topic.id,
          source,
          status: 'running',
        })

        try {
          let articles: any[] = []

          if (source === 'rss') {
            articles = await fetchFromRSS(topic, runId)
          } else if (source === 'perigon') {
            articles = await fetchFromPerigon(topic, runId)
          } else if (source === 'guardian') {
            articles = await fetchFromGuardian(topic, runId)
          } else if (source === 'gdelt') {
            articles = await fetchFromGDELT(topic)
          }

          if (articles.length === 0) {
            await supabase.from('ingestion_runs').update({
              status: 'success',
              articles_fetched: 0,
              articles_inserted: 0,
              articles_duplicate: 0,
              completed_at: new Date().toISOString(),
            }).eq('id', runId)

            results.push({ topic_id: topic.id, source, status: 'success', inserted: 0, fetched: 0 })
            continue
          }

          const rows = articles.map(a => ({
            ...a,
            topic_id: topic.id,
            user_id: topic.user_id,
            ingestion_run_id: runId,
          }))

          const { data: inserted, error: insertError } = await supabase
            .from('articles')
            .upsert(rows, {
              onConflict: 'topic_id,external_id,ingestion_source',
              ignoreDuplicates: true,
            })
            .select('id')

          if (insertError) {
            console.error('Upsert error:', insertError.message)
          }

          const insertedCount = inserted?.length ?? 0
          const duplicateCount = articles.length - insertedCount

          await supabase.from('ingestion_runs').update({
            status: 'success',
            articles_fetched: articles.length,
            articles_inserted: insertedCount,
            articles_duplicate: duplicateCount,
            completed_at: new Date().toISOString(),
          }).eq('id', runId)

          await supabase.from('monitored_topics').update({
            last_fetched_at: new Date().toISOString(),
          }).eq('id', topic.id)

          results.push({ topic_id: topic.id, source, status: 'success', inserted: insertedCount, fetched: articles.length })

          // Fire-and-forget enrichment trigger
          const projectUrl = Deno.env.get('SUPABASE_URL')!
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
          fetch(`${projectUrl}/functions/v1/enrich-articles`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ topic_id: topic.id })
          }).catch(err => console.error('Failed to trigger enrichment:', err))

        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          console.error(`Ingestion failed for topic ${topic.id} / ${source}:`, errorMsg)

          await supabase.from('ingestion_runs').update({
            status: 'failed',
            error_message: errorMsg,
            completed_at: new Date().toISOString(),
          }).eq('id', runId)

          results.push({ topic_id: topic.id, source, status: 'failed', error: errorMsg })
        }
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('fetch-articles top-level error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ─── PERIGON ─────────────────────────────────────────────────────────────────

async function fetchFromPerigon(topic: any, _runId: string): Promise<any[]> {
  if (!topic.keywords?.length) {
    console.warn(`Topic "${topic.name}" has no keywords — skipping Perigon`)
    return []
  }
  const apiKey = Deno.env.get('PERIGON_API_KEY')
  if (!apiKey) throw new Error('PERIGON_API_KEY not configured')

  const keywords = topic.keywords as string[]
  const expandedQuery = buildPerigonQuery(keywords)
  const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  console.log(`Perigon query for topic "${topic.name}": ${expandedQuery}`)

  const allArticles: any[] = []
  const fetchErrors: string[] = []

  // ── FETCH 1: Expanded keywords + explicit major outlet domains ──
  try {
    const url = new URL('https://api.goperigon.com/v1/all')
    url.searchParams.set('q', expandedQuery)
    url.searchParams.set('from', from)
    url.searchParams.set('language', topic.language ?? 'en')
    url.searchParams.set('source', MAJOR_OUTLET_DOMAINS.join(','))
    url.searchParams.set('sortBy', 'relevance')
    url.searchParams.set('showReprints', 'false')
    url.searchParams.set('size', '50')
    url.searchParams.set('apiKey', apiKey)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url.toString(), { signal: controller.signal })
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      const data = await res.json()
      const articles = normalisePerigonArticles(data.articles ?? [], 'perigon-major')
      allArticles.push(...articles)
      console.log(`Perigon major outlets: ${articles.length} articles`)
    } finally {
      clearTimeout(timeout)
    }
  } catch (err: any) {
    fetchErrors.push(`major: ${err.message}`)
    console.error('Perigon major outlets fetch failed:', err.message)
  }

  // ── FETCH 2: Top100 group with expanded query ──
  try {
    const url = new URL('https://api.goperigon.com/v1/all')
    url.searchParams.set('q', expandedQuery)
    url.searchParams.set('from', from)
    url.searchParams.set('language', topic.language ?? 'en')
    url.searchParams.set('sourceGroup', 'top100')
    url.searchParams.set('sortBy', 'relevance')
    url.searchParams.set('showReprints', 'false')
    url.searchParams.set('size', '30')
    url.searchParams.set('apiKey', apiKey)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url.toString(), { signal: controller.signal })
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      const data = await res.json()
      const articles = normalisePerigonArticles(data.articles ?? [], 'perigon-top100')
      allArticles.push(...articles)
      console.log(`Perigon top100: ${articles.length} articles`)
    } finally {
      clearTimeout(timeout)
    }
  } catch (err: any) {
    fetchErrors.push(`top100: ${err.message}`)
    console.error('Perigon top100 fetch failed (non-fatal):', err.message)
  }

  // ── FETCH 3: Original keywords + major outlets + sorted by date (breaking news) ──
  try {
    const originalQuery = keywords
      .map((k: string) => k.includes(' ') ? `"${k}"` : k)
      .join(' OR ')

    const url = new URL('https://api.goperigon.com/v1/all')
    url.searchParams.set('q', originalQuery)
    url.searchParams.set('from', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    url.searchParams.set('language', topic.language ?? 'en')
    url.searchParams.set('source', MAJOR_OUTLET_DOMAINS.join(','))
    url.searchParams.set('sortBy', 'date')
    url.searchParams.set('showReprints', 'false')
    url.searchParams.set('size', '20')
    url.searchParams.set('apiKey', apiKey)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url.toString(), { signal: controller.signal })
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      const data = await res.json()
      const articles = normalisePerigonArticles(data.articles ?? [], 'perigon-recent')
      allArticles.push(...articles)
      console.log(`Perigon recent: ${articles.length} articles`)
    } finally {
      clearTimeout(timeout)
    }
  } catch (err: any) {
    console.warn('Perigon recent fetch failed (non-fatal):', err.message)
  }

  if (allArticles.length === 0 && fetchErrors.length >= 2) {
    throw new Error(`Perigon fetches failed: ${fetchErrors.join('; ')}`)
  }

  // Deduplicate by URL hash
  const seen = new Set<string>()
  const deduped = allArticles.filter(a => {
    if (seen.has(a.external_id)) return false
    seen.add(a.external_id)
    return true
  })

  console.log(`Perigon total unique: ${deduped.length} (from ${allArticles.length} raw)`)
  return deduped
}

function normalisePerigonArticles(articles: any[], fetchSource: string): any[] {
  return articles
    .filter((a: any) => a.title && a.url && a.source?.domain)
    .map((a: any) => ({
      external_id: hashUrl(a.url),
      source_name: a.source?.name ?? a.source?.domain ?? 'Unknown',
      source_url: a.source?.domain ?? '',
      title: a.title,
      description: a.description ?? a.summary ?? null,
      content: a.content ?? null,
      author: a.authorsByline ?? (a.authors?.[0]?.name ?? null),
      published_at: a.pubDate ?? a.addDate ?? new Date().toISOString(),
      url: a.url,
      image_url: a.imageUrl ?? null,
      language: a.language ?? 'en',
      media_type: 'web',
      country: a.source?.country ?? null,
      ingestion_source: fetchSource,
    }))
}

// ─── THE GUARDIAN ────────────────────────────────────────────────────────────

async function fetchFromGuardian(topic: any, _runId: string): Promise<any[]> {
  const apiKey = Deno.env.get('GUARDIAN_API_KEY')
  if (!apiKey) {
    console.warn('GUARDIAN_API_KEY not configured — skipping Guardian fetch')
    return []
  }

  const keywords = topic.keywords as string[]
  const allTerms = expandKeywords(keywords)
  const query = allTerms
    .map((k: string) => k.includes(' ') ? `"${k}"` : k)
    .join(' OR ')

  const fromDate = new Date(Date.now() - 48 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const allArticles: any[] = []
  const editions = ['uk', 'us', 'au']

  for (const edition of editions) {
    try {
      const url = new URL('https://content.guardianapis.com/search')
      url.searchParams.set('q', query)
      url.searchParams.set('from-date', fromDate)
      url.searchParams.set('order-by', 'relevance')
      url.searchParams.set('show-fields', 'headline,trailText,bodyText,thumbnail,byline,wordcount')
      url.searchParams.set('show-tags', 'keyword')
      url.searchParams.set('page-size', '30')
      url.searchParams.set('edition', edition)
      url.searchParams.set('api-key', apiKey)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(url.toString(), { signal: controller.signal })
        if (!res.ok) throw new Error(`Guardian API responded ${res.status} for edition ${edition}`)

        const data = await res.json()
        if (data.response?.status !== 'ok') {
          throw new Error(`Guardian API error: ${data.response?.message}`)
        }

        const articles = (data.response?.results ?? []).map((a: any) => ({
          external_id: hashUrl(a.webUrl),
          source_name: 'The Guardian',
          source_url: 'theguardian.com',
          title: a.fields?.headline ?? a.webTitle,
          description: a.fields?.trailText ?? null,
          content: a.fields?.bodyText ?? null,
          author: a.fields?.byline ?? null,
          published_at: a.webPublicationDate,
          url: a.webUrl,
          image_url: a.fields?.thumbnail ?? null,
          language: 'en',
          media_type: 'web',
          country: edition === 'us' ? 'US' : edition === 'au' ? 'AU' : 'GB',
          ingestion_source: `guardian-${edition}`,
        }))

        allArticles.push(...articles)
        console.log(`Guardian ${edition} returned ${articles.length} articles for topic ${topic.id}`)
      } finally {
        clearTimeout(timeout)
      }
    } catch (err: any) {
      console.error(`Guardian ${edition} fetch failed (non-fatal):`, err.message)
    }
  }

  const seen = new Set<string>()
  return allArticles.filter(a => {
    if (seen.has(a.external_id)) return false
    seen.add(a.external_id)
    return true
  })
}

// ─── GDELT ───────────────────────────────────────────────────────────────────

async function fetchFromGDELT(topic: any): Promise<any[]> {
  const query = topic.keywords.join(' ')
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=100&format=json&timespan=1d`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`GDELT responded ${res.status}`)

    const data = await res.json()

    return (data.articles ?? [])
      .filter((a: any) => a.title && a.url)
      .map((a: any) => ({
        external_id: hashUrl(a.url),
        source_name: a.domain ?? 'Unknown',
        source_url: a.domain ?? '',
        title: a.title,
        description: null,
        content: null,
        author: null,
        published_at: parseGDELTDate(a.seendate),
        url: a.url,
        image_url: null,
        language: a.language ?? topic.language ?? 'en',
        media_type: 'web',
        country: a.sourcecountry,
        ingestion_source: 'gdelt',
      }))
  } finally {
    clearTimeout(timeout)
  }
}

// ─── RSS ─────────────────────────────────────────────────────────────────────

async function fetchFromRSS(topic: any, _runId: string): Promise<any[]> {
  if (!topic.keywords?.length) {
    console.warn(`Topic "${topic.name}" has no keywords — skipping RSS`)
    return []
  }
  const keywords = topic.keywords as string[]
  const expandedTerms = expandKeywords(keywords)
  const searchTerms = expandedTerms.map(k => k.toLowerCase())

  const { data: sources, error } = await supabase
    .from('sources')
    .select('id, name, rss_url, domain, language, country_code, health_status, consecutive_failures, fetch_priority')
    .eq('active', true)
    .eq('approval_status', 'approved')
    .not('rss_url', 'is', null)
    .lt('consecutive_failures', 20)
    .order('fetch_priority', { ascending: false })
    .limit(500)

  if (error) {
    console.error('Failed to fetch sources:', error.message)
    return []
  }

  if (!sources?.length) {
    console.warn('No active sources found')
    return []
  }

  console.log(`Processing ${sources.length} RSS sources for topic "${topic.name}"`)

  const allArticles: any[] = []
  const BATCH_SIZE = 20

  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(source => fetchSingleRSSFeed(source, searchTerms, topic))
    )
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        allArticles.push(...result.value)
      }
    }
  }

  console.log(`RSS total: ${allArticles.length} relevant articles`)

  const seen = new Set<string>()
  return allArticles.filter(a => {
    if (seen.has(a.external_id)) return false
    seen.add(a.external_id)
    return true
  })
}

async function fetchSingleRSSFeed(
  source: any,
  searchTerms: string[],
  topic: any
): Promise<any[]> {
  let feedUrl = source.rss_url
  if (!feedUrl && source.domain) {
    const d = source.domain.replace(/^https?:\/\//, '')
    feedUrl = `https://${d}/feed`
  }
  if (!feedUrl) return []

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WaveWatch/1.0 (media monitoring)' }
    })
    clearTimeout(timeout)

    if (!res.ok) {
      await supabase.from('sources').update({
        consecutive_failures: (source.consecutive_failures ?? 0) + 1,
        health_status: 'error'
      }).eq('id', source.id)
      return []
    }

    const xml = await res.text()
    if (xml.length > 1_000_000) return []

    const items = parseRSSXML(xml)
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)

    const relevant = items.filter(item => {
      if (item.pubDate && new Date(item.pubDate) < cutoff) return false
      const text = `${item.title ?? ''} ${item.description ?? ''}`.toLowerCase()
      return searchTerms.some(term => text.includes(term))
    })

    // Reset failures and update timestamps on success
    await supabase.from('sources').update({
      consecutive_failures: 0,
      health_status: 'healthy',
      last_fetched_at: new Date().toISOString(),
      last_success_at: new Date().toISOString()
    }).eq('id', source.id)

    return relevant.map(item => ({
      external_id: hashUrl(item.link ?? item.guid ?? ''),
      source_name: source.name ?? source.domain ?? '',
      source_url: source.domain ?? extractDomainName(feedUrl),
      title: item.title ?? '',
      description: item.description ?? null,
      content: item.content ?? null,
      author: item.author ?? null,
      published_at: item.pubDate ?? new Date().toISOString(),
      url: item.link ?? '',
      image_url: item.image ?? null,
      language: source.language ?? topic.language ?? 'en',
      media_type: 'web',
      country: source.country_code ?? null,
      ingestion_source: 'rss',
    })).filter((a: any) => a.title && a.url)

  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.warn(`RSS feed failed for ${feedUrl}: ${err.message}`)
    }
    await supabase.from('sources').update({
      consecutive_failures: (source.consecutive_failures ?? 0) + 1,
      health_status: 'error'
    }).eq('id', source.id)
    return []
  }
}

function parseRSSXML(xml: string): any[] {
  const items: any[] = []
  const isAtom = xml.includes('<feed') && xml.includes('xmlns')

  if (isAtom) {
    const entryMatches = xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)
    for (const match of entryMatches) {
      const entry = match[1]
      items.push({
        title: extractXMLText(entry, 'title'),
        link: extractXMLAttr(entry, 'link', 'href') ?? extractXMLText(entry, 'link'),
        description: extractXMLText(entry, 'summary') ?? extractXMLText(entry, 'content'),
        pubDate: extractXMLText(entry, 'published') ?? extractXMLText(entry, 'updated'),
        author: extractXMLText(entry, 'name') ?? extractXMLText(entry, 'author'),
        guid: extractXMLText(entry, 'id'),
      })
    }
  } else {
    const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)
    for (const match of itemMatches) {
      const item = match[1]
      items.push({
        title: extractXMLText(item, 'title'),
        link: extractXMLText(item, 'link'),
        description: extractXMLText(item, 'description'),
        content: extractXMLText(item, 'content:encoded') ?? extractXMLText(item, 'content'),
        pubDate: extractXMLText(item, 'pubDate') ?? extractXMLText(item, 'dc:date'),
        author: extractXMLText(item, 'dc:creator') ?? extractXMLText(item, 'author'),
        guid: extractXMLText(item, 'guid'),
        image: extractXMLAttr(item, 'media:content', 'url') ??
               extractXMLAttr(item, 'media:thumbnail', 'url'),
      })
    }
  }

  return items.filter(i => i.title && (i.link || i.guid))
}

function extractXMLText(xml: string, tag: string): string | null {
  const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`, 'i'))
  if (cdataMatch) return cdataMatch[1].trim()
  const textMatch = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'))
  if (textMatch) return textMatch[1].replace(/<[^>]+>/g, '').trim() || null
  return null
}

function extractXMLAttr(xml: string, tag: string, attr: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'))
  return match ? match[1] : null
}

function extractDomainName(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') }
  catch { return url }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function hashUrl(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function parseGDELTDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 14) return new Date().toISOString()
  const y = dateStr.slice(0, 4), mo = dateStr.slice(4, 6), d = dateStr.slice(6, 8)
  const h = dateStr.slice(8, 10), mi = dateStr.slice(10, 12), s = dateStr.slice(12, 14)
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
}
