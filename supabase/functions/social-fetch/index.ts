import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function hashUrl(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) { h = ((h << 5) - h) + url.charCodeAt(i); h |= 0 }
  return Math.abs(h).toString(36)
}

const SOCIAL_KEYWORDS = [
  'corpower ocean', 'corpowerocean',
  'wave energy', 'tidal energy', 'ocean energy', 'marine energy',
  'wave power converter', 'wave energy converter',
  'minesto', 'orbital marine', 'eco wave power',
]

const SUBREDDITS = [
  'renewable', 'energy', 'CleanEnergy', 'environment',
  'marine', 'oceanography', 'engineering', 'technology',
  'investing', 'stocks', 'europe', 'science',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const { topic_id } = body

    const { data: topic } = topic_id
      ? await supabase.from('monitored_topics').select('*').eq('id', topic_id).maybeSingle()
      : { data: null }

    let keywords = SOCIAL_KEYWORDS
    if (topic) {
      const raw = topic.keywords
      let topicKws: string[] = []
      if (Array.isArray(raw)) topicKws = raw.filter((k: any) => typeof k === 'string')
      else if (typeof raw === 'string') { try { topicKws = JSON.parse(raw) } catch {} }
      if (topicKws.length) keywords = [...new Set([...topicKws.map((k: string) => k.toLowerCase()), ...SOCIAL_KEYWORDS])]
    }

    const allArticles: any[] = []
    const sourceCounts: Record<string, number> = { reddit: 0, youtube: 0 }
    const errors: string[] = []
    const topicId = topic?.id ?? null
    const userId = topic?.user_id ?? null

    const makeArticle = (fields: any) => ({
      is_duplicate: false,
      source_category: 'social',
      topic_id: topicId,
      user_id: userId,
      ...fields,
    })

    // ── REDDIT ────────────────────────────────────────────────────────
    const redditKeywords = keywords.filter(k => k.length > 4).slice(0, 5)

    for (const keyword of redditKeywords) {
      for (const subreddit of SUBREDDITS.slice(0, 6)) {
        try {
          const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(keyword)}&sort=new&limit=10&t=week&restrict_sr=1`
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'WaveWatch/1.0 media monitoring (contact: admin@wavewatch.io)',
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(8000),
          })

          if (res.status === 429) {
            console.warn(`Reddit rate limit hit for r/${subreddit}`)
            await new Promise(r => setTimeout(r, 2000))
            continue
          }
          if (!res.ok) continue

          const data = await res.json()
          const posts = data?.data?.children ?? []

          for (const post of posts) {
            const p = post.data
            if (!p?.title || !p?.permalink) continue
            const text = `${p.title} ${p.selftext ?? ''}`.toLowerCase()
            const matched = keywords.filter(k => text.includes(k.toLowerCase()))
            if (!matched.length) continue

            const postUrl = `https://www.reddit.com${p.permalink}`
            allArticles.push(makeArticle({
              external_id: hashUrl(postUrl),
              source_name: `r/${p.subreddit}`,
              source_url: 'reddit.com',
              title: p.title,
              description: p.selftext ? p.selftext.slice(0, 300) + (p.selftext.length > 300 ? '…' : '') : null,
              author: p.author ?? null,
              published_at: new Date(p.created_utc * 1000).toISOString(),
              url: postUrl,
              image_url: p.thumbnail?.startsWith('http') ? p.thumbnail : null,
              language: 'en',
              media_type: 'social',
              ingestion_source: 'reddit',
              matched_keywords: matched,
              engagement_score: p.score ?? 0,
              comment_count: p.num_comments ?? 0,
            }))
          }
          sourceCounts.reddit++
          await new Promise(r => setTimeout(r, 300))
        } catch (err: any) {
          if (err.name !== 'AbortError') console.warn(`Reddit r/${subreddit} "${keyword}":`, err.message)
        }
      }
    }

    // Global Reddit search for brand mentions
    for (const keyword of ['corpower ocean', 'corpowerocean']) {
      try {
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=new&limit=25&t=month`
        const res = await fetch(url, {
          headers: { 'User-Agent': 'WaveWatch/1.0 media monitoring (contact: admin@wavewatch.io)' },
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const data = await res.json()
          for (const post of (data?.data?.children ?? [])) {
            const p = post.data
            if (!p?.title || !p?.permalink) continue
            const postUrl = `https://www.reddit.com${p.permalink}`
            allArticles.push(makeArticle({
              external_id: hashUrl(postUrl),
              source_name: `r/${p.subreddit}`,
              source_url: 'reddit.com',
              title: p.title,
              description: p.selftext?.slice(0, 300) ?? null,
              author: p.author ?? null,
              published_at: new Date(p.created_utc * 1000).toISOString(),
              url: postUrl,
              image_url: p.thumbnail?.startsWith('http') ? p.thumbnail : null,
              language: 'en',
              media_type: 'social',
              ingestion_source: 'reddit',
              matched_keywords: [keyword],
              engagement_score: p.score ?? 0,
              comment_count: p.num_comments ?? 0,
            }))
          }
        }
      } catch (err: any) {
        console.warn(`Reddit global "${keyword}":`, err.message)
      }
    }

    console.log(`Reddit: ${allArticles.filter(a => a.ingestion_source === 'reddit').length} posts found`)

    // ── YOUTUBE ───────────────────────────────────────────────────────
    const youtubeKey = Deno.env.get('YOUTUBE_API_KEY')
    if (youtubeKey) {
      const ytKeywords = ['wave energy converter', 'marine energy', 'CorPower Ocean', 'tidal energy turbine', 'ocean wave power']
      for (const keyword of ytKeywords.slice(0, 5)) {
        try {
          const url = new URL('https://www.googleapis.com/youtube/v3/search')
          url.searchParams.set('part', 'snippet')
          url.searchParams.set('q', keyword)
          url.searchParams.set('type', 'video')
          url.searchParams.set('order', 'date')
          url.searchParams.set('maxResults', '10')
          url.searchParams.set('publishedAfter', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          url.searchParams.set('relevanceLanguage', 'en')
          url.searchParams.set('key', youtubeKey)

          const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
          if (!res.ok) {
            console.error(`YouTube API error for "${keyword}": ${res.status}`)
            errors.push(`YouTube: HTTP ${res.status}`)
            continue
          }

          const data = await res.json()
          for (const item of (data.items ?? [])) {
            const vid = item.snippet
            if (!vid?.title || !item.id?.videoId) continue
            const text = `${vid.title} ${vid.description ?? ''}`.toLowerCase()
            const matched = keywords.filter(k => text.includes(k.toLowerCase()))
            if (!matched.length) matched.push(keyword)

            const videoUrl = `https://www.youtube.com/watch?v=${item.id.videoId}`
            allArticles.push(makeArticle({
              external_id: hashUrl(videoUrl),
              source_name: vid.channelTitle ?? 'YouTube',
              source_url: 'youtube.com',
              title: vid.title,
              description: vid.description?.slice(0, 300) ?? null,
              author: vid.channelTitle ?? null,
              published_at: vid.publishedAt,
              url: videoUrl,
              image_url: vid.thumbnails?.medium?.url ?? vid.thumbnails?.default?.url ?? null,
              language: 'en',
              media_type: 'video',
              ingestion_source: 'youtube',
              matched_keywords: matched,
              engagement_score: 0,
            }))
          }
          sourceCounts.youtube++
          console.log(`YouTube "${keyword}": ${(data.items ?? []).length} videos`)
        } catch (err: any) {
          console.error(`YouTube "${keyword}":`, err.message)
          errors.push(`YouTube: ${err.message}`)
        }
      }
    } else {
      console.warn('YOUTUBE_API_KEY not configured — skipping YouTube')
      errors.push('YouTube: YOUTUBE_API_KEY not set')
    }

    console.log(`Social fetch total: ${allArticles.length} items`)

    if (!allArticles.length) {
      return json({ inserted: 0, found: 0, sources: sourceCounts, errors })
    }

    // Deduplicate by URL
    const seen = new Set<string>()
    const deduped = allArticles.filter(a => {
      if (!a.url || seen.has(a.url)) return false
      seen.add(a.url)
      return true
    })

    // Upsert in batches of 50
    let insertedCount = 0
    for (let i = 0; i < deduped.length; i += 50) {
      const batch = deduped.slice(i, i + 50)
      const { data: ins, error: insertError } = await supabase
        .from('articles')
        .upsert(batch, { onConflict: 'url', ignoreDuplicates: true })
        .select('id')
      if (insertError) {
        console.error(`Social insert batch ${i}:`, insertError.message)
        errors.push(`DB: ${insertError.message}`)
      } else {
        insertedCount += ins?.length ?? 0
      }
    }

    return json({
      inserted: insertedCount,
      found: allArticles.length,
      sources: sourceCounts,
      errors: errors.length ? errors : undefined,
    })
  } catch (err: any) {
    console.error('social-fetch error:', err.message)
    return json({ error: err.message }, 500)
  }
})