// This function is deprecated. RSS fetching is now handled inside
// fetch-articles/index.ts via the fetchRSSUnified function.
// This stub prevents the old function from running.
Deno.serve(async (_req) => {
  return new Response(
    JSON.stringify({
      message: 'fetch-rss is deprecated. Use fetch-articles instead.',
      deprecated: true
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
