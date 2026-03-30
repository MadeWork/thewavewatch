import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ─── PERIGON SOURCE CONFIGURATION ────────────────────────────────────────────
const PERIGON_TIER1_SOURCES = [
  // ── WIRE SERVICES ──
  'reuters.com', 'apnews.com', 'afp.com', 'bloomberg.com',
  // ── UNITED STATES ──
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com',
  'cnbc.com', 'cnn.com', 'nbcnews.com', 'abcnews.go.com',
  'cbsnews.com', 'npr.org', 'politico.com', 'theatlantic.com',
  'time.com', 'forbes.com', 'usatoday.com', 'latimes.com', 'businessinsider.com',
  // ── UNITED KINGDOM ──
  'theguardian.com', 'bbc.com', 'bbc.co.uk', 'thetimes.co.uk',
  'telegraph.co.uk', 'independent.co.uk', 'sky.com', 'ft.com',
  // ── EUROPE — NORDIC ──
  'dn.se', 'svd.se', 'di.se', 'aftonbladet.se',
  'aftenposten.no', 'dn.no', 'vg.no', 'nrk.no', 'e24.no',
  'berlingske.dk', 'politiken.dk', 'borsen.dk', 'dr.dk',
  'yle.fi', 'hs.fi',
  // ── EUROPE — MAJOR NATIONAL ──
  'spiegel.de', 'faz.net', 'sueddeutsche.de', 'zeit.de', 'dw.com',
  'lemonde.fr', 'lefigaro.fr', 'lesechos.fr',
  'euractiv.com', 'politico.eu',
  // ── AUSTRALIA ──
  'abc.net.au', 'smh.com.au', 'theage.com.au', 'afr.com',
  'theaustralian.com.au', 'news.com.au', 'sbs.com.au',
  // ── NEW ZEALAND ──
  'nzherald.co.nz', 'stuff.co.nz', 'rnz.co.nz', 'newsroom.co.nz',
].join(',')

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

          if (source === 'perigon') {
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
  const apiKey = Deno.env.get('PERIGON_API_KEY')
  if (!apiKey) throw new Error('PERIGON_API_KEY not configured')

  const keywords = topic.keywords as string[]
  const query = keywords
    .map((k: string) => k.includes(' ') ? `"${k}"` : k)
    .join(' OR ')

  const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const allArticles: any[] = []

  // ── FETCH 1: Keyword search scoped to top100 sources ──
  try {
    const url = new URL('https://api.goperigon.com/v1/all')
    url.searchParams.set('q', query)
    url.searchParams.set('from', from)
    url.searchParams.set('language', topic.language ?? 'en')
    url.searchParams.set('sourceGroup', 'top100')
    url.searchParams.set('sortBy', 'relevance')
    url.searchParams.set('showReprints', 'false')
    url.searchParams.set('size', '50')
    url.searchParams.set('apiKey', apiKey)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url.toString(), { signal: controller.signal })
      if (!res.ok) throw new Error(`Perigon responded ${res.status}: ${await res.text()}`)
      const data = await res.json()
      const articles = normalisePerigonArticles(data.articles ?? [], 'perigon-top100')
      allArticles.push(...articles)
      console.log(`Perigon top100 returned ${articles.length} articles for topic ${topic.id}`)
    } finally {
      clearTimeout(timeout)
    }
  } catch (err: any) {
    console.error('Perigon top100 fetch failed:', err.message)
  }

  // ── FETCH 2: Broader search with explicit source domain filter ──
  try {
    const url = new URL('https://api.goperigon.com/v1/all')
    url.searchParams.set('q', query)
    url.searchParams.set('from', from)
    url.searchParams.set('language', topic.language ?? 'en')
    url.searchParams.set('source', PERIGON_TIER1_SOURCES)
    url.searchParams.set('sortBy', 'date')
    url.searchParams.set('showReprints', 'false')
    url.searchParams.set('size', '50')
    url.searchParams.set('apiKey', apiKey)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url.toString(), { signal: controller.signal })
      if (!res.ok) throw new Error(`Perigon explicit sources responded ${res.status}: ${await res.text()}`)
      const data = await res.json()
      const articles = normalisePerigonArticles(data.articles ?? [], 'perigon-explicit')
      allArticles.push(...articles)
      console.log(`Perigon explicit sources returned ${articles.length} articles for topic ${topic.id}`)
    } finally {
      clearTimeout(timeout)
    }
  } catch (err: any) {
    console.error('Perigon explicit sources fetch failed (non-fatal):', err.message)
  }

  // Deduplicate within batch by URL
  const seen = new Set<string>()
  return allArticles.filter(a => {
    if (seen.has(a.external_id)) return false
    seen.add(a.external_id)
    return true
  })
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
  const query = keywords
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
