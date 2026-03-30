import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

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
      for (const source of topic.sources ?? ['newsapi']) {
        const runId = crypto.randomUUID()

        await supabase.from('ingestion_runs').insert({
          id: runId,
          topic_id: topic.id,
          source,
          status: 'running',
        })

        try {
          let articles: any[] = []

          if (source === 'newsapi') {
            articles = await fetchFromNewsAPI(topic)
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

async function fetchFromNewsAPI(topic: any): Promise<any[]> {
  const apiKey = Deno.env.get('NEWSAPI_KEY')
  if (!apiKey) throw new Error('NEWSAPI_KEY not configured')

  const query = topic.keywords.join(' OR ')
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${from}&language=${topic.language ?? 'en'}&sortBy=publishedAt&pageSize=100&apiKey=${apiKey}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`NewsAPI responded ${res.status}: ${await res.text()}`)

    const data = await res.json()
    if (data.status !== 'ok') throw new Error(`NewsAPI error: ${data.message}`)

    return (data.articles ?? [])
      .filter((a: any) => a.title && a.url && !a.title.includes('[Removed]'))
      .map((a: any) => ({
        external_id: hashUrl(a.url),
        source_name: a.source?.name ?? 'Unknown',
        source_url: a.source?.id ?? a.url,
        title: a.title,
        description: a.description,
        content: a.content,
        author: a.author,
        published_at: a.publishedAt,
        url: a.url,
        image_url: a.urlToImage,
        language: topic.language ?? 'en',
        media_type: 'web',
        ingestion_source: 'newsapi',
      }))
  } finally {
    clearTimeout(timeout)
  }
}

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
