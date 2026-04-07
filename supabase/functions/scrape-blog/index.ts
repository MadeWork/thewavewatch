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

const BLOG_URL = 'https://corpowerocean.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const blogUrl = body.blog_url || BLOG_URL
    const userId = body.user_id

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!firecrawlKey) {
      return json({ error: 'FIRECRAWL_API_KEY not configured' }, 500)
    }

    // Step 1: Map the blog to find all post URLs
    console.log(`Mapping blog: ${blogUrl}`)
    const mapRes = await fetch('https://api.firecrawl.dev/v1/map', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: blogUrl,
        search: 'blog post news update',
        limit: 100,
        includeSubdomains: false,
      }),
    })

    if (!mapRes.ok) {
      const errText = await mapRes.text()
      console.error('Firecrawl map error:', mapRes.status, errText)
      return json({ error: `Map failed: ${mapRes.status}` }, 500)
    }

    const mapData = await mapRes.json()
    const allLinks: string[] = mapData.links ?? []

    // Filter for blog/news post URLs
    const blogLinks = allLinks.filter(url => {
      const lower = url.toLowerCase()
      return (
        lower.includes('/blog') ||
        lower.includes('/news') ||
        lower.includes('/press') ||
        lower.includes('/update') ||
        lower.includes('/post') ||
        lower.includes('/article') ||
        // Dated URL patterns like /2024/03/
        /\/20\d{2}\/\d{2}/.test(lower)
      )
    }).slice(0, 30) // Limit to 30 posts to conserve credits

    console.log(`Found ${allLinks.length} total URLs, ${blogLinks.length} blog-like URLs`)

    if (!blogLinks.length) {
      return json({ found: 0, inserted: 0, total_urls: allLinks.length, message: 'No blog URLs found' })
    }

    // Step 2: Scrape each blog post
    const articles: any[] = []
    let credits = 0

    for (const postUrl of blogLinks) {
      try {
        const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: postUrl,
            formats: ['markdown'],
            onlyMainContent: true,
          }),
        })

        if (scrapeRes.status === 402) {
          console.warn('Firecrawl credits exhausted, stopping')
          break
        }

        if (!scrapeRes.ok) continue
        credits++

        const scrapeData = await scrapeRes.json()
        const content = scrapeData.data?.markdown || scrapeData.markdown || ''
        const metadata = scrapeData.data?.metadata || scrapeData.metadata || {}

        if (!metadata.title && !content) continue

        // Extract description from first paragraph of content
        const firstParagraph = content
          .split('\n')
          .filter((l: string) => l.trim() && !l.startsWith('#') && !l.startsWith('!')
          )
          .slice(0, 2)
          .join(' ')
          .slice(0, 300)

        // Try to extract publish date from metadata or URL
        let publishedAt: string | null = metadata.publishedTime || metadata.datePublished || null
        if (!publishedAt) {
          const dateMatch = postUrl.match(/\/(\d{4})\/(\d{2})(?:\/(\d{2}))?/)
          if (dateMatch) {
            publishedAt = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3] || '01'}`).toISOString()
          }
        }

        // Extract key themes from content
        const themes: string[] = []
        const themeKeywords = ['wave energy', 'ocean energy', 'marine energy', 'C4', 'HiWave-5', 
          'partnership', 'funding', 'milestone', 'testing', 'deployment', 'Portugal', 'Sweden']
        const lowerContent = content.toLowerCase()
        for (const theme of themeKeywords) {
          if (lowerContent.includes(theme.toLowerCase())) themes.push(theme)
        }

        articles.push({
          title: metadata.title || postUrl.split('/').pop()?.replace(/-/g, ' ') || 'Blog Post',
          url: postUrl,
          description: metadata.description || firstParagraph || null,
          content: content.slice(0, 5000),
          source_name: 'CorPower Ocean Blog',
          source_url: 'corpowerocean.com',
          source_category: 'owned',
          media_type: 'blog',
          ingestion_source: 'blog-scrape',
          published_at: publishedAt,
          user_id: userId ?? null,
          language: metadata.language || 'en',
          image_url: metadata.ogImage || metadata.image || null,
          author: metadata.author || 'CorPower Ocean',
          key_themes: themes,
          matched_keywords: themes,
          is_duplicate: false,
        })
      } catch (err: any) {
        console.warn(`Failed to scrape ${postUrl}:`, err.message)
      }
    }

    console.log(`Scraped ${articles.length} blog posts (${credits} Firecrawl credits used)`)

    // Insert articles
    let inserted = 0
    for (let i = 0; i < articles.length; i += 50) {
      const batch = articles.slice(i, i + 50)
      const { data, error } = await supabase
        .from('articles')
        .upsert(batch, { onConflict: 'url', ignoreDuplicates: true })
        .select('id')
      if (error) {
        console.error('Insert error:', error.message)
      } else {
        inserted += data?.length ?? 0
      }
    }

    return json({
      found: articles.length,
      inserted,
      credits_used: credits,
      total_urls: allLinks.length,
      blog_urls: blogLinks.length,
    })
  } catch (err: any) {
    console.error('scrape-blog error:', err.message)
    return json({ error: err.message }, 500)
  }
})