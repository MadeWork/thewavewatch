import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (_req) => {
  const projectUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  console.log('Scheduled fetch triggered at', new Date().toISOString())

  try {
    const res = await fetch(`${projectUrl}/functions/v1/fetch-articles`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })

    const result = await res.json()
    console.log('Scheduled fetch completed:', JSON.stringify(result))

    return new Response(JSON.stringify({
      triggered: true,
      timestamp: new Date().toISOString(),
      result
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('Scheduled fetch failed:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
