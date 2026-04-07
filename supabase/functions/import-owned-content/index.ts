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

// Parse CSV string into rows, auto-detecting the header row
// LinkedIn exports often have a description row before the real headers
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  // Handle quoted CSV fields
  function splitCSVLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  // Known LinkedIn column names to detect the real header row
  const knownHeaders = ['date', 'impressions', 'clicks', 'likes', 'comments', 'shares', 'reposts', 'engagement', 'reactions', 'followers']

  function normalize(h: string): string {
    return h.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  }

  // Find the header row: first line where at least 2 known column names appear
  let headerIdx = 0
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cols = splitCSVLine(lines[i]).map(c => normalize(c))
    const matches = cols.filter(c => knownHeaders.some(k => c.includes(k)))
    if (matches.length >= 2) {
      headerIdx = i
      break
    }
  }

  const headers = splitCSVLine(lines[headerIdx]).map(h => normalize(h))
  console.log('Detected header row:', headerIdx, 'headers:', headers.join(', '))

  return lines.slice(headerIdx + 1).map(line => {
    const vals = splitCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  })
}

// LinkedIn CSV column mapping (LinkedIn exports vary, handle common formats)
function mapLinkedInRow(row: Record<string, string>, userId: string): any | null {
  // LinkedIn "Updates" export columns (common format):
  // "Post title", "Post link", "Type", "Campaign name", "Posted on", 
  // "Impressions", "Clicks", "Click through rate", "Likes", "Comments", "Reposts", "Engagement rate"
  
  const title = row.post_title || row.title || row.content || row.update || row.post || ''
  if (!title && !row.post_link) return null

  const url = row.post_link || row.url || row.link || ''
  const publishedAt = row.posted_on || row.date || row.published_date || row.created_date || ''
  
  let parsedDate: string | null = null
  if (publishedAt) {
    try {
      const d = new Date(publishedAt)
      if (!isNaN(d.getTime())) parsedDate = d.toISOString()
    } catch {}
  }

  return {
    title: title.slice(0, 500) || 'LinkedIn Post',
    url: url || `linkedin-post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: (row.description || row.content || title).slice(0, 1000),
    source_name: 'LinkedIn',
    source_url: 'linkedin.com',
    source_category: 'owned',
    media_type: 'social',
    ingestion_source: 'linkedin-csv',
    published_at: parsedDate,
    user_id: userId,
    language: 'en',
    impressions: parseInt(row.impressions || row.views || '0') || 0,
    clicks: parseInt(row.clicks || '0') || 0,
    shares: parseInt(row.reposts || row.shares || '0') || 0,
    engagement_score: parseInt(row.likes || row.reactions || '0') || 0,
    comment_count: parseInt(row.comments || '0') || 0,
    matched_keywords: [],
    is_duplicate: false,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { csv_text, user_id, platform } = await req.json()

    if (!csv_text || !user_id) {
      return json({ error: 'csv_text and user_id required' }, 400)
    }

    const rows = parseCSV(csv_text)
    if (!rows.length) return json({ error: 'No data rows found in CSV' }, 400)

    console.log(`Parsing ${rows.length} rows from ${platform || 'linkedin'} CSV`)
    console.log('CSV headers found:', Object.keys(rows[0]).join(', '))

    const articles = rows
      .map(row => mapLinkedInRow(row, user_id))
      .filter(Boolean)

    if (!articles.length) {
      return json({ error: 'No valid posts found. Check CSV format — expected columns like: Post title, Posted on, Impressions, Clicks, Likes, Comments' }, 400)
    }

    // Upsert by URL to avoid duplicates
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
      success: true,
      parsed: rows.length,
      mapped: articles.length,
      inserted,
      sample_columns: Object.keys(rows[0]),
    })
  } catch (err: any) {
    console.error('import-owned-content error:', err.message)
    return json({ error: err.message }, 500)
  }
})