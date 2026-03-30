import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const TIER1_DOMAINS = [
  // ─── GLOBAL WIRE SERVICES (highest priority — syndicated everywhere) ───
  'reuters.com',
  'apnews.com',
  'afp.com',
  // ─── UNITED STATES ───
  'nytimes.com',
  'washingtonpost.com',
  'wsj.com',
  'bloomberg.com',
  'ft.com',
  'forbes.com',
  'cnbc.com',
  'cnn.com',
  'nbcnews.com',
  'abcnews.go.com',
  'cbsnews.com',
  'npr.org',
  'politico.com',
  'theatlantic.com',
  'time.com',
  'businessinsider.com',
  'usatoday.com',
  'latimes.com',
  'chicagotribune.com',
  // ─── UNITED KINGDOM ───
  'theguardian.com',
  'bbc.com',
  'bbc.co.uk',
  'thetimes.co.uk',
  'telegraph.co.uk',
  'independent.co.uk',
  'standard.co.uk',
  'mirror.co.uk',
  'dailymail.co.uk',
  'thesun.co.uk',
  'sky.com',
  'channel4.com',
  // ─── EUROPE — NORDIC ───
  'dn.se',
  'svd.se',
  'di.se',
  'aftonbladet.se',
  'expressen.se',
  'aftenposten.no',
  'dn.no',
  'vg.no',
  'e24.no',
  'nrk.no',
  'berlingske.dk',
  'politiken.dk',
  'borsen.dk',
  'dr.dk',
  'yle.fi',
  'hs.fi',
  // ─── EUROPE — MAJOR NATIONAL OUTLETS ───
  'spiegel.de',
  'faz.net',
  'sueddeutsche.de',
  'zeit.de',
  'dw.com',
  'handelsblatt.com',
  'lemonde.fr',
  'lefigaro.fr',
  'lesechos.fr',
  'liberation.fr',
  'nrc.nl',
  'fd.nl',
  'nos.nl',
  'elpais.com',
  'elmundo.es',
  'corriere.it',
  'repubblica.it',
  'euractiv.com',
  'politico.eu',
  'thelocal.se',
  'thelocal.no',
  // ─── AUSTRALIA ───
  'abc.net.au',
  'smh.com.au',
  'theage.com.au',
  'afr.com',
  'theaustralian.com.au',
  'news.com.au',
  'theguardian.com/au',
  'sbs.com.au',
  '9news.com.au',
  '7news.com.au',
  // ─── NEW ZEALAND ───
  'nzherald.co.nz',
  'stuff.co.nz',
  'rnz.co.nz',
  'tvnz.co.nz',
  'newsroom.co.nz',
  'businessdesk.co.nz',
].join(',')

// NewsAPI named source IDs — for the /top-headlines endpoint
const TIER1_SOURCES = [
  // Wire
  'reuters',
  'associated-press',
  // US
  'the-new-york-times',
  'the-washington-post',
  'the-wall-street-journal',
  'bloomberg',
  'cnbc',
  'cnn',
  'nbc-news',
  'abc-news',
  'cbs-news',
  'npr',
  'politico',
  'time',
  'business-insider',
  'usa-today',
  // UK
  'the-guardian-uk',
  'bbc-news',
  'the-times',
  'the-telegraph',
  'the-independent',
  'mirror',
  'daily-mail',
  'sky-news',
  // Europe
  'der-spiegel',
  'le-monde',
  'ary-news',
  // Australia
  'abc-news-au',
  'australian-financial-review',
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
