import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const MAJOR_OUTLET_DOMAINS = [
  'reuters.com', 'apnews.com', 'bloomberg.com', 'afp.com',
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com',
  'cnbc.com', 'cnn.com', 'nbcnews.com', 'abcnews.go.com',
  'cbsnews.com', 'npr.org', 'politico.com', 'theatlantic.com',
  'time.com', 'forbes.com', 'usatoday.com', 'latimes.com',
  'businessinsider.com',
  'theguardian.com', 'bbc.com', 'bbc.co.uk', 'thetimes.co.uk',
  'telegraph.co.uk', 'independent.co.uk', 'sky.com', 'standard.co.uk',
  'heraldscotland.com', 'scotsman.com',
  'dn.se', 'svd.se', 'di.se',
  'spiegel.de', 'faz.net', 'dw.com',
  'lemonde.fr', 'lefigaro.fr', 'euractiv.com', 'politico.eu',
  'abc.net.au', 'smh.com.au', 'afr.com', 'nzherald.co.nz',
]

const KEYWORD_EXPANSIONS: Record<string, string[]> = {
  'marine energy':      ['wave energy', 'wave power', 'tidal energy', 'tidal power', 'ocean energy', 'ocean power', 'sea power', 'blue energy', 'offshore renewables', 'hydrokinetic', 'WEC'],
  'wave energy':        ['wave power', 'ocean power', 'marine energy', 'ocean energy', 'tidal energy'],
  'wave power':         ['wave energy', 'marine energy', 'ocean energy', 'tidal power'],
  'tidal energy':       ['tidal power', 'marine energy', 'ocean energy', 'tidal stream'],
  'offshore wind':      ['offshore wind farm', 'floating wind', 'wind farm'],
  'renewable energy':   ['clean energy', 'green energy', 'clean power', 'decarbonisation', 'net zero energy'],
  'carbon capture':     ['CCS', 'CCUS', 'carbon sequestration', 'net zero'],
  'climate change':     ['global warming', 'climate crisis', 'net zero', 'carbon emissions'],
}

function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set<string>()
  for (const kw of keywords) {
    expanded.add(kw)
    const lower = kw.toLowerCase()
    if (KEYWORD_EXPANSIONS[lower]) {
      for (const syn of KEYWORD_EXPANSIONS[lower]) expanded.add(syn)
    }
  }
  return Array.from(expanded)
}

function hashUrl(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function isMajorOutlet(domain: string): boolean {
  if (!domain) return false
  const d = domain.replace(/^(www\.|https?:\/\/)/, '').toLowerCase()
  return MAJOR_OUTLET_DOMAINS.some(m => d.includes(m))
}

function parseGDELTDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 14) return new Date().toISOString()
  const y = dateStr.slice(0, 4), mo = dateStr.slice(4, 6), d = dateStr.slice(6, 8)
  const h = dateStr.slice(8, 10), mi = dateStr.slice(10, 12), s = dateStr.slice(12, 14)
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
}

// ─── GUARDIAN BACKFILL ───────────────────────────────────────────────────────

async function backfillGuardian(keywords: string[], fromDate: string, topicId: string, userId: string): Promise<any[]> {
  const apiKey = Deno.env.get('GUARDIAN_API_KEY')
  if (!apiKey) {
    console.warn('GUARDIAN_API_KEY not set — skipping Guardian backfill')
    return []
  }

  const allTerms = expandKeywords(keywords)
  const query = allTerms.map(k => k.includes(' ') ? `"${k}"` : k).join(' OR ')
  const allArticles: any[] = []
  const editions = ['uk', 'us', 'au']

  for (const edition of editions) {
    // Paginate up to 5 pages (50 results per page = 250 per edition)
    for (let page = 1; page <= 5; page++) {
      try {
        const url = new URL('https://content.guardianapis.com/search')
        url.searchParams.set('q', query)
        url.searchParams.set('from-date', fromDate)
        url.searchParams.set('order-by', 'relevance')
        url.searchParams.set('show-fields', 'headline,trailText,bodyText,thumbnail,byline,wordcount')
        url.searchParams.set('page-size', '50')
        url.searchParams.set('page', String(page))
        url.searchParams.set('edition', edition)
        url.searchParams.set('api-key', apiKey)

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        try {
          const res = await fetch(url.toString(), { signal: controller.signal })
          if (!res.ok) break

          const data = await res.json()
          if (data.response?.status !== 'ok') break

          const results = data.response?.results ?? []
          if (results.length === 0) break

          const articles = results.map((a: any) => ({
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
            ingestion_source: `guardian-backfill-${edition}`,
            topic_id: topicId,
            user_id: userId,
            is_major_outlet: true,
          }))

          allArticles.push(...articles)
          console.log(`Guardian backfill ${edition} page ${page}: ${articles.length} articles`)

          if (results.length < 50) break // no more pages
        } finally {
          clearTimeout(timeout)
        }
      } catch (err: any) {
        console.error(`Guardian backfill ${edition} page ${page} failed:`, err.message)
        break
      }
    }
  }

  return allArticles
}

// ─── GDELT BACKFILL ──────────────────────────────────────────────────────────

async function backfillGDELT(keywords: string[], fromDate: string, topicId: string, userId: string): Promise<any[]> {
  const allTerms = expandKeywords(keywords)
  // Use GDELT's HybridRel sorting which prioritises major outlets
  const query = `(${allTerms.map(k => k.includes(' ') ? `"${k}"` : k).join(' OR ')}) (theme:RENEWABLE_ENERGY OR theme:ENV_CLIMATECHANGE)`

  // Calculate timespan in days from fromDate
  const fromMs = new Date(fromDate).getTime()
  const nowMs = Date.now()
  const days = Math.min(Math.ceil((nowMs - fromMs) / (24 * 60 * 60 * 1000)), 180)

  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=250&format=json&sort=HybridRel&timespan=${days}d`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`GDELT responded ${res.status}`)

    const data = await res.json()
    const articles = (data.articles ?? [])
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
        language: a.language ?? 'en',
        media_type: 'web',
        country: a.sourcecountry,
        ingestion_source: 'gdelt-backfill',
        topic_id: topicId,
        user_id: userId,
        is_major_outlet: isMajorOutlet(a.domain ?? ''),
      }))

    console.log(`GDELT backfill: ${articles.length} articles (${days}d lookback)`)
    return articles
  } catch (err: any) {
    console.error('GDELT backfill failed:', err.message)
    return []
  } finally {
    clearTimeout(timeout)
  }
}

// ─── PERIGON BACKFILL ────────────────────────────────────────────────────────

async function backfillPerigon(keywords: string[], fromDate: string, topicId: string, userId: string): Promise<any[]> {
  const apiKey = Deno.env.get('PERIGON_API_KEY')
  if (!apiKey) {
    console.warn('PERIGON_API_KEY not set — skipping Perigon backfill')
    return []
  }

  const allTerms = expandKeywords(keywords)
  const query = allTerms.map(k => k.includes(' ') ? `"${k}"` : k).join(' OR ')

  const url = new URL('https://api.goperigon.com/v1/all')
  url.searchParams.set('q', query)
  url.searchParams.set('from', fromDate)
  url.searchParams.set('sourceGroup', 'top100')
  url.searchParams.set('sortBy', 'relevance')
  url.searchParams.set('showReprints', 'false')
  url.searchParams.set('size', '100')
  url.searchParams.set('apiKey', apiKey)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) throw new Error(`Perigon responded ${res.status}`)

    const data = await res.json()
    const articles = (data.articles ?? [])
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
        ingestion_source: 'perigon-backfill',
        topic_id: topicId,
        user_id: userId,
        is_major_outlet: isMajorOutlet(a.source?.domain ?? ''),
      }))

    console.log(`Perigon backfill: ${articles.length} articles`)
    return articles
  } catch (err: any) {
    console.error('Perigon backfill failed:', err.message)
    return []
  } finally {
    clearTimeout(timeout)
  }
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { topic_id, months = 3 } = await req.json().catch(() => ({}))

    if (!topic_id) {
      return new Response(JSON.stringify({ error: 'topic_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const lookbackMonths = Math.min(Math.max(Number(months) || 3, 1), 6)
    const fromDate = new Date(Date.now() - lookbackMonths * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    console.log(`Backfill starting: topic=${topic_id}, months=${lookbackMonths}, from=${fromDate}`)

    // Fetch topic
    const { data: topic, error: topicError } = await supabase
      .from('monitored_topics')
      .select('*')
      .eq('id', topic_id)
      .single()

    if (topicError || !topic) {
      return new Response(JSON.stringify({ error: 'Topic not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const keywords = topic.keywords ?? []
    if (keywords.length === 0) {
      return new Response(JSON.stringify({ error: 'Topic has no keywords' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Run all three sources in parallel
    const [guardianArticles, gdeltArticles, perigonArticles] = await Promise.all([
      backfillGuardian(keywords, fromDate, topic.id, topic.user_id),
      backfillGDELT(keywords, fromDate, topic.id, topic.user_id),
      backfillPerigon(keywords, fromDate, topic.id, topic.user_id),
    ])

    const allArticles = [...guardianArticles, ...gdeltArticles, ...perigonArticles]

    // Deduplicate
    const seen = new Set<string>()
    const deduped = allArticles.filter(a => {
      const key = `${a.topic_id}:${a.external_id}:${a.ingestion_source}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    console.log(`Backfill: ${deduped.length} unique articles (${allArticles.length} raw)`)

    // Bulk upsert in chunks
    let insertedCount = 0
    const CHUNK_SIZE = 200
    for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
      const chunk = deduped.slice(i, i + CHUNK_SIZE)
      const { data: inserted, error: insertError } = await supabase
        .from('articles')
        .upsert(chunk, {
          onConflict: 'url',
          ignoreDuplicates: true,
        })
        .select('id')

      if (insertError) {
        console.error('Backfill upsert error:', insertError.message)
      }
      insertedCount += inserted?.length ?? 0
    }

    // Trigger enrichment
    const projectUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    fetch(`${projectUrl}/functions/v1/enrich-articles`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }).catch(err => console.error('Failed to trigger enrichment after backfill:', err))

    const result = {
      topic: topic.name,
      months: lookbackMonths,
      guardian: guardianArticles.length,
      gdelt: gdeltArticles.length,
      perigon: perigonArticles.length,
      total_unique: deduped.length,
      inserted: insertedCount,
    }

    console.log('Backfill complete:', JSON.stringify(result))

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('backfill-articles error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
