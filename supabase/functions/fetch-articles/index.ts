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
  'marine energy':      ['wave energy', 'wave power', 'tidal energy', 'tidal power', 'ocean energy', 'ocean power', 'hydrokinetic', 'wave energy converter'],
  'wave energy':        ['wave power', 'ocean power', 'marine energy', 'ocean energy', 'tidal energy'],
  'wave power':         ['wave energy', 'marine energy', 'ocean energy', 'tidal power'],
  'tidal energy':       ['tidal power', 'marine energy', 'ocean energy', 'tidal stream', 'tidal current'],
  'ocean energy':       ['wave energy', 'wave power', 'tidal energy', 'marine energy', 'hydrokinetic'],
}

// Short/ambiguous terms that MUST NOT be used for substring matching
// These caused false positives (e.g. WEC = World Endurance Championship, not Wave Energy Converter)
const BLOCKED_SHORT_TERMS = new Set(['wec', 'ev', 'ai', 'llm', 'ccs', 'ccus'])

function getTopicKeywords(topic: any): string[] {
  const raw = topic.keywords
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(k => typeof k === 'string')
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(k => typeof k === 'string') : []
    } catch { return [] }
  }
  return []
}

function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set<string>()
  for (const kw of keywords) {
    expanded.add(kw)
    const lower = kw.toLowerCase()
    if (KEYWORD_EXPANSIONS[lower]) {
      for (const syn of KEYWORD_EXPANSIONS[lower]) expanded.add(syn)
    }
    for (const [key, syns] of Object.entries(KEYWORD_EXPANSIONS)) {
      if (lower.includes(key) && lower !== key) {
        for (const syn of syns) expanded.add(syn)
      }
    }
  }
  // Remove blocked short terms that cause false positives
  for (const blocked of BLOCKED_SHORT_TERMS) {
    expanded.delete(blocked)
  }
  return Array.from(expanded)
}

/** Word-boundary aware matching: ensures multi-word terms match as phrases
 *  and single-word terms match as whole words (not substrings) */
function textMatchesTerm(text: string, term: string): boolean {
  const lower = term.toLowerCase()
  if (BLOCKED_SHORT_TERMS.has(lower)) return false
  // For terms shorter than 4 chars, require word boundaries
  if (lower.length < 4) return false
  // Use word-boundary regex for all terms
  try {
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'i')
    return regex.test(text)
  } catch {
    return text.includes(lower)
  }
}

function buildPerigonQuery(keywords: string[]): string {
  const expanded = expandKeywords(keywords)
  return expanded
    .map(k => {
      const trimmed = k.trim()
      return trimmed.includes(' ') ? `"${trimmed}"` : trimmed
    })
    .join(' OR ')
}

// ─── BROAD ENERGY TERMS (for high-priority source matching) ─────────────────
const BROAD_ENERGY_TERMS = ['renewable','clean energy','offshore','ocean','maritime','marine','tidal','wave power','corpower','minesto','orbital marine','energy transition','net zero','decarboni','floating wind','seabed','hydrokinetic','blue energy']

// Major outlets that get relaxed matching — include if any monitored
// keyword appears ANYWHERE in the title (not requiring body match)
const MAJOR_OUTLET_DOMAINS_SET = new Set([
  'reuters.com', 'bbc.com', 'bbc.co.uk', 'bloomberg.com', 'ft.com',
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'theguardian.com',
  'apnews.com', 'cnbc.com', 'forbes.com', 'economist.com',
  'politico.com', 'politico.eu', 'euractiv.com', 'euronews.com',
  'aftenposten.no', 'dn.se', 'svd.se', 'di.se', 'nrk.no',
  'dn.no', 'vg.no', 'hs.fi', 'yle.fi', 'berlingske.dk',
  'spiegel.de', 'faz.net', 'lemonde.fr', 'corriere.it',
  'dw.com', 'handelsblatt.com', 'independent.co.uk', 'thetimes.co.uk',
  'telegraph.co.uk', 'heraldscotland.com', 'scotsman.com',
  'carbonbrief.org', 'energymonitor.ai',
])

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
  'heraldscotland.com', 'scotsman.com', 'pressandjournal.co.uk',
  // European majors
  'euronews.com', 'euractiv.com', 'politico.eu',
  'spiegel.de', 'faz.net', 'sueddeutsche.de', 'dw.com', 'handelsblatt.com',
  'lemonde.fr', 'lefigaro.fr', 'lecho.be',
  'elpais.com', 'corriere.it', 'repubblica.it',
  // Nordics
  'dn.se', 'svd.se', 'di.se', 'aftonbladet.se', 'expressen.se',
  'aftenposten.no', 'dn.no', 'vg.no', 'nrk.no', 'e24.no',
  'berlingske.dk', 'politiken.dk', 'borsen.dk', 'dr.dk',
  'yle.fi', 'hs.fi',
  // Australia/NZ
  'abc.net.au', 'smh.com.au', 'theage.com.au', 'afr.com',
  'theaustralian.com.au', 'news.com.au', 'sbs.com.au',
  'nzherald.co.nz', 'stuff.co.nz', 'rnz.co.nz', 'newsroom.co.nz',
  // Key energy/climate
  'carbonbrief.org', 'energymonitor.ai',
]

function extractDomain(url: string): string | null {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch { return null }
}

/** Resolve Google News redirect URLs in parallel batches.
 *  Returns a Map of googleUrl → resolvedUrl */
async function resolveGoogleNewsUrls(urls: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const unique = [...new Set(urls.filter(u => u.includes('news.google.com')))]
  if (unique.length === 0) return results

  // Resolve in batches of 10 with 2s timeout each
  const BATCH = 10
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map(async (gUrl) => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 2000)
        const res = await fetch(gUrl, {
          method: 'HEAD', redirect: 'manual', signal: ctrl.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        })
        clearTimeout(t)
        const loc = res.headers.get('location')
        if (loc && !loc.includes('news.google.com') && !loc.includes('consent.google')) {
          return { gUrl, resolved: loc }
        }
      } catch { /* timeout/error — fall through */ }
      return { gUrl, resolved: gUrl }
    }))
    for (const r of settled) {
      if (r.status === 'fulfilled') results.set(r.value.gUrl, r.value.resolved)
    }
  }
  console.log(`Resolved ${results.size} Google News URLs (${[...results.values()].filter(v => !v.includes('news.google.com')).length} to publisher)`)
  return results
}

/** Extract publisher name from Google News title format "Article Title - Publisher" */
function extractGoogleNewsPublisher(title: string): { cleanTitle: string; publisher: string } {
  const dashIdx = title.lastIndexOf(' - ')
  if (dashIdx > 0) {
    return { cleanTitle: title.slice(0, dashIdx).trim(), publisher: title.slice(dashIdx + 3).trim() }
  }
  return { cleanTitle: title, publisher: '' }
}

// ─── MAIN HANDLER (UNIFIED) ─────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { topic_id, include_newsapi } = await req.json().catch(() => ({}))
    const startTime = Date.now()

    // 1. Fetch all active topics
    let topicQuery = supabase
      .from('monitored_topics')
      .select('*')
      .eq('is_active', true)

    if (topic_id) topicQuery = topicQuery.eq('id', topic_id)

    const { data: topics, error } = await topicQuery
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!topics?.length) {
      return new Response(JSON.stringify({ results: [], message: 'No active topics found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build per-topic search terms using ONLY topic-specific keywords + expansions
    const topicSearchData = topics.map(t => {
      const keywords = getTopicKeywords(t)
      if (!keywords.length) {
        console.warn(`Topic "${t.name}" has no keywords — will match nothing`)
      }
      const allTerms = new Set<string>()
      const expanded = expandKeywords(keywords)
      for (const e of expanded) allTerms.add(e.toLowerCase())
      console.log(`Topic "${t.name}": ${allTerms.size} search terms from ${keywords.length} keywords`)
      return {
        topic: t,
        keywords,
        expandedTerms: Array.from(allTerms),
      }
    })

    // Create a single ingestion run for the whole batch
    const runId = crypto.randomUUID()
    await supabase.from('ingestion_runs').insert({
      id: runId,
      topic_id: topics[0].id,
      source: 'unified',
      status: 'running',
    })

    const allArticles: any[] = []
    const healthUpdates: Map<string, { id: string; success: boolean; failures: number }> = new Map()
    const sourceResults: any[] = []

    // 2. Unified RSS — fetch each source ONCE, match against ALL topics
    try {
      const rssResult = await fetchRSSUnified(topicSearchData, healthUpdates)
      allArticles.push(...rssResult)
      sourceResults.push({ source: 'rss', count: rssResult.length })
      console.log(`RSS unified: ${rssResult.length} articles`)
    } catch (err: any) {
      console.error('RSS unified failed:', err.message)
      sourceResults.push({ source: 'rss', count: 0, error: err.message })
    }

    // 3. Unified Perigon — ONE request combining all topic keywords
    try {
      const perigonResult = await fetchPerigonUnified(topicSearchData)
      allArticles.push(...perigonResult)
      sourceResults.push({ source: 'perigon', count: perigonResult.length })
      console.log(`Perigon unified: ${perigonResult.length} articles`)
    } catch (err: any) {
      console.error('Perigon unified failed:', err.message)
      sourceResults.push({ source: 'perigon', count: 0, error: err.message })
    }

    // 4. Guardian — still per-topic (free API, no credit concern)
    for (const td of topicSearchData) {
      if (!td.topic.sources?.includes('guardian')) continue
      try {
        const guardianArticles = await fetchFromGuardian(td.topic)
        const mapped = guardianArticles.map(a => ({
          ...a,
          topic_id: td.topic.id,
          user_id: td.topic.user_id,
          ingestion_run_id: runId,
        }))
        allArticles.push(...mapped)
        sourceResults.push({ source: `guardian-${td.topic.name}`, count: mapped.length })
      } catch (err: any) {
        console.error(`Guardian failed for ${td.topic.name}:`, err.message)
      }
    }

    // 5. GDELT — still per-topic (free, no credit concern)
    for (const td of topicSearchData) {
      if (!td.topic.sources?.includes('gdelt')) continue
      try {
        const gdeltArticles = await fetchFromGDELT(td.topic)
        const mapped = gdeltArticles.map(a => {
          const text = `${a.title ?? ''} ${a.description ?? ''}`.toLowerCase()
          const matchedKws = td.keywords.filter(kw => textMatchesTerm(text, kw))
          return {
            ...a,
            topic_id: td.topic.id,
            user_id: td.topic.user_id,
            ingestion_run_id: runId,
            matched_keywords: matchedKws,
          }
        })
        allArticles.push(...mapped)
        sourceResults.push({ source: `gdelt-${td.topic.name}`, count: mapped.length })
      } catch (err: any) {
        console.error(`GDELT failed for ${td.topic.name}:`, err.message)
      }
    }

    // 5b. NewsAPI — ON-DEMAND ONLY (free tier: 100 req/day)
    if (include_newsapi) {
      const newsapiKey = Deno.env.get('NEWSAPI_KEY')
      if (newsapiKey) {
        for (const td of topicSearchData) {
          try {
            const newsapiArticles = await fetchFromNewsAPI(td, newsapiKey)
            const mapped = newsapiArticles.map(a => ({
              ...a,
              topic_id: td.topic.id,
              user_id: td.topic.user_id,
              ingestion_run_id: runId,
            }))
            allArticles.push(...mapped)
            sourceResults.push({ source: `newsapi-${td.topic.name}`, count: mapped.length })
            console.log(`NewsAPI for "${td.topic.name}": ${mapped.length} articles`)
          } catch (err: any) {
            console.error(`NewsAPI failed for ${td.topic.name}:`, err.message)
            sourceResults.push({ source: `newsapi-${td.topic.name}`, count: 0, error: err.message })
          }
        }
      } else {
        console.warn('NewsAPI key not configured, skipping')
      }
    }

    // 6. Bulk upsert all articles
    let insertedCount = 0
    if (allArticles.length > 0) {
      // Stamp all articles with the run ID
      for (const a of allArticles) {
        if (!a.ingestion_run_id) a.ingestion_run_id = runId
      }
      // Filter to English + European languages only
      const ALLOWED_LANGUAGES = new Set([
        'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'da', 'sv', 'no', 'nb', 'nn', 'fi',
        'pl', 'cs', 'hu', 'ro', 'bg', 'hr', 'sk', 'sl', 'et', 'lv', 'lt', 'el', 'ga',
        'ca', 'eu', 'gl', 'is', 'mt', 'lb', 'cy',
      ])
      const langFiltered = allArticles.filter(a => {
        const lang = (a.language || 'en').toLowerCase().split('-')[0]
        return ALLOWED_LANGUAGES.has(lang)
      })
      console.log(`Language filter: ${allArticles.length} → ${langFiltered.length} (removed ${allArticles.length - langFiltered.length} non-EN/EU)`)

      // Deduplicate by URL (since url has a unique constraint)
      const seen = new Set<string>()
      const deduped = langFiltered.filter(a => {
        const key = a.url
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Sanitize dates to prevent "time zone not recognized" errors
      for (const a of deduped) {
        if (a.published_at) {
          const d = new Date(a.published_at)
          a.published_at = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
        }
      }

      console.log(`Bulk upserting ${deduped.length} articles (from ${allArticles.length} raw)`)

      // Upsert in chunks of 200 to avoid payload limits
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
          console.error('Upsert error:', insertError.message)
        }
        insertedCount += inserted?.length ?? 0
      }
    }

    // 7. Bulk health updates for RSS sources
    if (healthUpdates.size > 0) {
      const now = new Date().toISOString()
      const successIds: string[] = []
      const failUpdates: { id: string; failures: number }[] = []

      for (const [, update] of healthUpdates) {
        if (update.success) {
          successIds.push(update.id)
        } else {
          failUpdates.push({ id: update.id, failures: update.failures })
        }
      }

      // Bulk reset healthy sources
      if (successIds.length > 0) {
        await supabase.from('sources').update({
          consecutive_failures: 0,
          health_status: 'healthy',
          last_fetched_at: now,
          last_success_at: now,
        }).in('id', successIds)
      }

      // Bulk update failed sources using upsert
      if (failUpdates.length > 0) {
        const failRows = failUpdates.map(f => ({
          id: f.id,
          consecutive_failures: f.failures,
          health_status: f.failures >= 20 ? 'error' : 'degraded',
        }))
        for (const row of failRows) {
          await supabase.from('sources').update({
            consecutive_failures: row.consecutive_failures,
            health_status: row.health_status,
          }).eq('id', row.id)
        }
      }
    }

    // 8. Update all topic timestamps
    const topicIds = topics.map(t => t.id)
    await supabase.from('monitored_topics').update({
      last_fetched_at: new Date().toISOString(),
    }).in('id', topicIds)

    // 9. Complete ingestion run
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await supabase.from('ingestion_runs').update({
      status: 'success',
      articles_fetched: allArticles.length,
      articles_inserted: insertedCount,
      articles_duplicate: allArticles.length - insertedCount,
      completed_at: new Date().toISOString(),
      metadata: { sources: sourceResults, elapsed_seconds: elapsed },
    }).eq('id', runId)

    // 10. Single enrichment trigger at the end
    const projectUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    fetch(`${projectUrl}/functions/v1/enrich-articles`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }).catch(err => console.error('Failed to trigger enrichment:', err))

    console.log(`Unified ingestion complete in ${elapsed}s: ${insertedCount} inserted, ${allArticles.length} fetched`)

    return new Response(JSON.stringify({
      results: sourceResults,
      total_fetched: allArticles.length,
      total_inserted: insertedCount,
      elapsed_seconds: elapsed,
    }), {
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

// ─── UNIFIED RSS ─────────────────────────────────────────────────────────────

interface TopicSearchData {
  topic: any
  keywords: string[]
  expandedTerms: string[]
}

async function fetchRSSUnified(
  topicSearchData: TopicSearchData[],
  healthUpdates: Map<string, { id: string; success: boolean; failures: number }>
): Promise<any[]> {
  const { data: sources, error } = await supabase
    .from('sources')
    .select('id, name, rss_url, domain, language, country_code, health_status, consecutive_failures, fetch_priority')
    .eq('active', true)
    .eq('approval_status', 'approved')
    .not('rss_url', 'is', null)
    .lt('consecutive_failures', 30)
    .in('health_status', ['healthy', 'degraded'])
    .order('fetch_priority', { ascending: false })
    .limit(300)

  if (error || !sources?.length) {
    if (error) console.error('Failed to fetch sources:', error.message)
    return []
  }

  console.log(`RSS unified: processing ${sources.length} sources against ${topicSearchData.length} topics`)

  const allArticles: any[] = []
  const googleNewsPending: { item: any; source: any; td: any }[] = []
  const BATCH_SIZE = 50
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(source => fetchSingleRSSFeedUnified(source, cutoff))
    )

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      const source = batch[j]

      if (result.status === 'fulfilled') {
        const { items, success, failures } = result.value
        healthUpdates.set(source.id, { id: source.id, success, failures })

        // Match each item against ALL topics
        for (const item of items) {
          const text = `${item.title ?? ''} ${item.description ?? ''}`.toLowerCase()

          for (const td of topicSearchData) {
            if (!td.topic.sources?.includes('rss')) continue

            // Google News feeds are pre-filtered by Google's search — trust them
            const isGoogleNews = (source.domain ?? '').includes('news.google.com')
              || (source.rss_url ?? '').includes('news.google.com')

            if (isGoogleNews) {
              const pubDate = item.pubDate ? new Date(item.pubDate) : new Date()
              const ageDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24)
              // Extract publisher from title suffix "Article Title - Publisher Name"
              const rawTitle = item.title ?? ''
              const dashIdx = rawTitle.lastIndexOf(' - ')
              const publisherName = dashIdx > 0 ? rawTitle.slice(dashIdx + 3).trim() : ''
              const cleanTitle = dashIdx > 0 ? rawTitle.slice(0, dashIdx).trim() : rawTitle
              // Resolve redirect URL to actual publisher URL
              const resolvedUrl = await resolveGoogleNewsUrl(item.link ?? '')
              const resolvedDomain = extractDomain(resolvedUrl) ?? 'news.google.com'
              const isMajor = MAJOR_OUTLET_DOMAINS.some(m => resolvedDomain.includes(m))
              allArticles.push({
                external_id: hashUrl(resolvedUrl || item.link || item.guid || ''),
                source_name: publisherName || source.name || '',
                source_url: resolvedDomain,
                source_domain: resolvedDomain,
                title: cleanTitle,
                description: item.description ?? null,
                content: item.content ?? null,
                author: item.author ?? null,
                published_at: item.pubDate ?? new Date().toISOString(),
                url: resolvedUrl || item.link || '',
                image_url: item.image ?? null,
                language: source.language ?? 'en',
                media_type: 'web',
                country: source.country_code ?? null,
                ingestion_source: 'rss',
                topic_id: td.topic.id,
                user_id: td.topic.user_id,
                ingestion_run_id: undefined,
                is_major_outlet: isMajor,
                articles_era: ageDays <= 7 ? 'live' : ageDays <= 30 ? 'recent' : 'archive',
              })
              continue
            }

            const isMajorOutlet = MAJOR_OUTLET_DOMAINS_SET.has(source.domain ?? '')
              || MAJOR_OUTLET_DOMAINS.some(m => (source.domain ?? '').includes(m))

            // For major outlets: match if keyword appears in title only
            const titleText = (item.title ?? '').toLowerCase()
            const titleMatch = isMajorOutlet
              && td.expandedTerms.some(term => textMatchesTerm(titleText, term))

            const exactMatch = td.expandedTerms.some(term => textMatchesTerm(text, term))
            const broadMatch = !exactMatch
              && (source.fetch_priority ?? 0) >= 80
              && BROAD_ENERGY_TERMS.some(term => text.includes(term))

            if (exactMatch || broadMatch || titleMatch) {
                const domain = source.domain ?? extractDomainName(source.rss_url)
                const resolvedDomain = extractDomain(item.link ?? '') ?? domain
                const pubDate = item.pubDate ? new Date(item.pubDate) : new Date()
                const ageDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24)
                const matchedKws = td.keywords.filter(kw => textMatchesTerm(text, kw))
                allArticles.push({
                external_id: hashUrl(item.link ?? item.guid ?? ''),
                source_name: source.name ?? source.domain ?? '',
                source_url: domain,
                source_domain: resolvedDomain,
                title: item.title ?? '',
                description: item.description ?? null,
                content: item.content ?? null,
                author: item.author ?? null,
                published_at: item.pubDate ?? new Date().toISOString(),
                url: item.link ?? '',
                image_url: item.image ?? null,
                language: source.language ?? td.topic.language ?? 'en',
                media_type: 'web',
                country: source.country_code ?? null,
                ingestion_source: 'rss',
                topic_id: td.topic.id,
                user_id: td.topic.user_id,
                ingestion_run_id: undefined,
                matched_keywords: matchedKws,
                is_major_outlet: MAJOR_OUTLET_DOMAINS.some(m => (resolvedDomain || '').includes(m)),
                articles_era: ageDays <= 7 ? 'live' : ageDays <= 30 ? 'recent' : 'archive',
              })
            }
          }
        }
      } else {
        healthUpdates.set(source.id, {
          id: source.id,
          success: false,
          failures: (source.consecutive_failures ?? 0) + 1,
        })
      }
    }
  }

  return allArticles
}

async function fetchSingleRSSFeedUnified(
  source: any,
  cutoff: Date
): Promise<{ items: any[]; success: boolean; failures: number }> {
  let feedUrl = source.rss_url
  if (!feedUrl && source.domain) {
    const d = source.domain.replace(/^https?:\/\//, '')
    feedUrl = `https://${d}/feed`
  }
  if (!feedUrl) return { items: [], success: true, failures: 0 }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    })
    clearTimeout(timeout)

    if (!res.ok) {
      return { items: [], success: false, failures: (source.consecutive_failures ?? 0) + 1 }
    }

    const xml = await res.text()
    if (xml.length > 1_000_000) return { items: [], success: true, failures: 0 }

    const items = parseRSSXML(xml).filter(item => {
      if (item.pubDate && new Date(item.pubDate) < cutoff) return false
      return true
    })

    return { items, success: true, failures: 0 }
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name !== 'AbortError') {
      console.warn(`RSS feed failed for ${feedUrl}: ${err.message}`)
    }
    return { items: [], success: false, failures: (source.consecutive_failures ?? 0) + 1 }
  }
}

// ─── UNIFIED PERIGON ─────────────────────────────────────────────────────────

async function fetchPerigonUnified(topicSearchData: TopicSearchData[]): Promise<any[]> {
  const apiKey = Deno.env.get('PERIGON_API_KEY')
  if (!apiKey) {
    console.warn('PERIGON_API_KEY not configured — skipping')
    return []
  }

  // Combine ALL keywords from ALL topics into one query
  const allKeywords = new Set<string>()
  for (const td of topicSearchData) {
    if (!td.topic.sources?.includes('perigon')) continue
    for (const kw of td.keywords) allKeywords.add(kw)
  }

  if (allKeywords.size === 0) return []

  const globalQuery = buildPerigonQuery(Array.from(allKeywords))
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  console.log(`Perigon unified query (${allKeywords.size} keywords): ${globalQuery.slice(0, 200)}...`)

  const url = new URL('https://api.goperigon.com/v1/all')
  url.searchParams.set('q', globalQuery)
  url.searchParams.set('from', from)
  url.searchParams.set('sourceGroup', 'top100')
  url.searchParams.set('category', 'Energy,Environment,Science,Business,Tech,Politics')
  url.searchParams.set('sortBy', 'relevance')
  url.searchParams.set('showReprints', 'false')
  url.searchParams.set('size', '100')
  url.searchParams.set('apiKey', apiKey)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)

    const data = await res.json()
    const rawArticles = normalisePerigonArticles(data.articles ?? [], 'perigon')
    console.log(`Perigon returned ${rawArticles.length} articles`)

    // Route each article to matching topics
    const routed: any[] = []
    for (const article of rawArticles) {
      const text = `${article.title ?? ''} ${article.description ?? ''}`.toLowerCase()

      for (const td of topicSearchData) {
        if (!td.topic.sources?.includes('perigon')) continue
        const matches = td.expandedTerms.some(term => textMatchesTerm(text, term))
        if (matches) {
          const matchedKws = td.keywords.filter(kw => textMatchesTerm(text, kw))
          routed.push({
            ...article,
            topic_id: td.topic.id,
            user_id: td.topic.user_id,
            matched_keywords: matchedKws,
          })
        }
      }

      // If no topic matched, discard — the article isn't relevant
      if (!routed.some(r => r.external_id === article.external_id)) {
        console.log(`Perigon: discarding unmatched article "${article.title?.slice(0, 60)}"`)
      }
    }

    // Deduplicate
    const seen = new Set<string>()
    return routed.filter(a => {
      const key = `${a.topic_id}:${a.external_id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  } catch (err: any) {
    console.error('Perigon unified fetch failed:', err.message)
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

function normalisePerigonArticles(articles: any[], fetchSource: string): any[] {
  return articles
    .filter((a: any) => a.title && a.url && a.source?.domain)
    .map((a: any) => {
      const pubDate = new Date(a.pubDate ?? a.addDate ?? Date.now())
      const ageDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24)
      const domain = a.source?.domain ?? extractDomain(a.url) ?? ''
      return {
        external_id: hashUrl(a.url),
        source_name: a.source?.name ?? domain ?? 'Unknown',
        source_url: domain,
        source_domain: domain,
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
        is_major_outlet: MAJOR_OUTLET_DOMAINS.some(m => (domain).includes(m)),
        articles_era: ageDays <= 7 ? 'live' : ageDays <= 30 ? 'recent' : 'archive',
      }
    })
}

// ─── THE GUARDIAN ────────────────────────────────────────────────────────────

async function fetchFromGuardian(topic: any): Promise<any[]> {
  const apiKey = Deno.env.get('GUARDIAN_API_KEY')
  if (!apiKey) {
    console.warn('GUARDIAN_API_KEY not configured — skipping')
    return []
  }

  const keywords = getTopicKeywords(topic)
  if (!keywords.length) {
    console.warn(`Guardian: Topic "${topic.name}" has no keywords — skipping`)
    return []
  }
  const allTerms = expandKeywords(keywords)
  const query = allTerms
    .map((k: string) => k.includes(' ') ? `"${k}"` : k)
    .join(' OR ')

  const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
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
      url.searchParams.set('page-size', '50')
      url.searchParams.set('edition', edition)
      url.searchParams.set('api-key', apiKey)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(url.toString(), { signal: controller.signal })
        if (!res.ok) throw new Error(`Guardian API responded ${res.status} for edition ${edition}`)

        const data = await res.json()
        if (data.response?.status !== 'ok') throw new Error(`Guardian API error: ${data.response?.message}`)

        const articles = (data.response?.results ?? []).map((a: any) => {
          const pubDate = new Date(a.webPublicationDate ?? Date.now())
          const ageDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24)
          return {
            external_id: hashUrl(a.webUrl),
            source_name: 'The Guardian',
            source_url: 'theguardian.com',
            source_domain: 'theguardian.com',
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
            matched_keywords: keywords.filter(kw => textMatchesTerm(`${a.fields?.headline ?? ''} ${a.fields?.trailText ?? ''}`, kw)),
            is_major_outlet: true,
            articles_era: ageDays <= 7 ? 'live' : ageDays <= 30 ? 'recent' : 'archive',
          }
        })

        allArticles.push(...articles)
        console.log(`Guardian ${edition}: ${articles.length} articles`)
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
  const keywords = getTopicKeywords(topic)
  if (!keywords.length) {
    console.warn(`GDELT: Topic "${topic.name}" has no keywords — skipping`)
    return []
  }
  const allTerms = expandKeywords(keywords)
  const query = allTerms.map((k: string) => k.includes(' ') ? `"${k}"` : k).join(' OR ')
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=100&format=json&sort=HybridRel&timespan=7d`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`GDELT responded ${res.status}`)

    const data = await res.json()
    return (data.articles ?? [])
      .filter((a: any) => a.title && a.url)
      .map((a: any) => {
        const pubDateStr = parseGDELTDate(a.seendate)
        const pubDate = new Date(pubDateStr)
        const ageDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24)
        const gdeltDomain = extractDomain(a.url) ?? a.domain ?? ''
        return {
          external_id: hashUrl(a.url),
          source_name: a.domain ?? 'Unknown',
          source_url: a.domain ?? '',
          source_domain: gdeltDomain,
          title: a.title,
          description: null,
          content: null,
          author: null,
          published_at: pubDateStr,
          url: a.url,
          image_url: null,
          language: a.language ?? topic.language ?? 'en',
          media_type: 'web',
          country: a.sourcecountry,
          ingestion_source: 'gdelt',
          is_major_outlet: MAJOR_OUTLET_DOMAINS.some(m => gdeltDomain.includes(m)),
          articles_era: ageDays <= 7 ? 'live' : ageDays <= 30 ? 'recent' : 'archive',
        }
      })
  } finally {
    clearTimeout(timeout)
  }
}

// ─── RSS PARSER ──────────────────────────────────────────────────────────────

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

// ─── NEWSAPI (ON-DEMAND) ────────────────────────────────────────────────────

async function fetchFromNewsAPI(td: TopicSearchData, apiKey: string): Promise<any[]> {
  const articles: any[] = []
  // Use top 3 keywords to build a focused query (conserve API calls)
  const queryTerms = td.keywords.slice(0, 3).map(k =>
    k.includes(' ') ? `"${k}"` : k
  )
  const q = queryTerms.join(' OR ')
  if (!q) return []

  // Use 'everything' endpoint for broader coverage, 7-day lookback
  const fromDate = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const params = new URLSearchParams({
    q,
    from: fromDate,
    sortBy: 'relevancy',
    pageSize: '50',
    language: 'en',
    apiKey,
  })

  try {
    const resp = await fetch(`https://newsapi.org/v2/everything?${params}`, {
      headers: { 'User-Agent': 'WaveWatch/1.0' },
    })

    if (!resp.ok) {
      const errBody = await resp.text()
      console.error(`NewsAPI HTTP ${resp.status}: ${errBody.slice(0, 200)}`)
      return []
    }

    const data = await resp.json()
    if (data.status !== 'ok' || !data.articles?.length) return []

    for (const item of data.articles) {
      if (!item.title || !item.url || item.title === '[Removed]') continue
      const domain = extractDomain(item.url) || ''
      const isMajor = MAJOR_OUTLET_DOMAINS.some(d => domain.includes(d))
      const text = `${item.title} ${item.description || ''}`.toLowerCase()
      const matchedKws = td.keywords.filter(kw => textMatchesTerm(text, kw))
      if (matchedKws.length === 0) continue

      articles.push({
        title: item.title,
        url: item.url,
        description: item.description || null,
        snippet: item.description || null,
        content: item.content || null,
        author: item.author || null,
        image_url: item.urlToImage || null,
        published_at: item.publishedAt ? new Date(item.publishedAt).toISOString() : new Date().toISOString(),
        source_name: item.source?.name || domain,
        source_domain: domain,
        source_category: 'media',
        is_major_outlet: isMajor,
        matched_keywords: matchedKws,
        discovery_method: 'newsapi',
        ingestion_source: 'newsapi',
        language: 'en',
        sentiment: 'neutral',
        sentiment_score: 0.5,
        fetched_at: new Date().toISOString(),
      })
    }
  } catch (err: any) {
    console.error('NewsAPI fetch error:', err.message)
  }

  return articles
}
