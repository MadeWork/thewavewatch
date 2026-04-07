import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Search, ExternalLink, RefreshCw, ThumbsUp, MessageSquare, Play } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";

const PLATFORM_COLORS: Record<string, string> = {
  reddit:  "bg-orange-500/15 text-orange-400 border-orange-500/20",
  youtube: "bg-red-500/15 text-red-400 border-red-500/20",
};

function getPlatform(source: string): string {
  if (source === 'reddit' || source?.includes('reddit')) return 'reddit'
  if (source === 'youtube' || source?.includes('youtube')) return 'youtube'
  return 'social'
}

export default function Social() {
  const [quickSearch, setQuickSearch] = useState("")
  const [platformFilter, setPlatformFilter] = useState("all")
  const [isFetching, setIsFetching] = useState(false)
  const [lastFetch, setLastFetch] = useState<string | null>(null)

  const { data: articles, isLoading, error, refetch } = useQuery({
    queryKey: ["social-mentions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("source_category", "social")
        .order("published_at", { ascending: false })
        .limit(500)
      if (error) throw error
      return data as any[]
    },
  })

  const runFetch = async () => {
    setIsFetching(true)
    try {
      const { data: topic } = await supabase
        .from('monitored_topics')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single()

      await supabase.functions.invoke('social-fetch', {
        body: { topic_id: topic?.id },
      })
      await refetch()
      setLastFetch(format(new Date(), "HH:mm"))
    } catch (err: any) {
      console.error('Social fetch error:', err.message)
    } finally {
      setIsFetching(false)
    }
  }

  const platforms = useMemo(() => {
    const s = new Set<string>()
    ;(articles ?? []).forEach(a => s.add(getPlatform(a.ingestion_source || a.source_url || '')))
    return Array.from(s)
  }, [articles])

  const filtered = useMemo(() => {
    let result = articles ?? []
    if (platformFilter !== "all") {
      result = result.filter(a => getPlatform(a.ingestion_source || a.source_url || '') === platformFilter)
    }
    if (quickSearch) {
      const q = quickSearch.toLowerCase()
      result = result.filter(a =>
        a.title?.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q)
      )
    }
    return result
  }, [articles, quickSearch, platformFilter])

  const redditCount = (articles ?? []).filter(a => getPlatform(a.ingestion_source || '') === 'reddit').length
  const youtubeCount = (articles ?? []).filter(a => getPlatform(a.ingestion_source || '') === 'youtube').length

  if (error) return <ErrorBanner message={(error as Error).message} />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Social Mentions</h1>
          <span className="text-xs text-muted-foreground">({filtered.length})</span>
        </div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="text-xs text-muted-foreground">Last fetched {lastFetch}</span>
          )}
          <button
            onClick={runFetch}
            disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
          >
            {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isFetching ? 'Fetching…' : 'Fetch Now'}
          </button>
        </div>
      </div>

      {/* Platform summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card">
          <span className="text-2xl">🟠</span>
          <div>
            <p className="text-sm font-medium text-foreground">Reddit</p>
            <p className="text-2xl font-semibold text-foreground">{redditCount}</p>
            <p className="text-xs text-muted-foreground">posts & comments</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card">
          <span className="text-2xl">▶️</span>
          <div>
            <p className="text-sm font-medium text-foreground">YouTube</p>
            <p className="text-2xl font-semibold text-foreground">{youtubeCount}</p>
            <p className="text-xs text-muted-foreground">
              videos
              {youtubeCount === 0 && ' — add YOUTUBE_API_KEY to enable'}
            </p>
          </div>
        </div>
      </div>

      {youtubeCount === 0 && redditCount === 0 && !isLoading && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-sm text-muted-foreground">
            No social data yet.{' '}
            Click "Fetch Now" to pull Reddit posts. To enable YouTube,
            add a YOUTUBE_API_KEY to your backend secrets (Google Cloud Console → YouTube Data API v3 → free tier).
          </p>
        </div>
      )}

      {/* Quick search + platform filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={quickSearch}
            onChange={e => setQuickSearch(e.target.value)}
            placeholder="Search social mentions…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-card border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
          />
        </div>
        <div className="flex gap-1.5">
          {["all", ...platforms].map(p => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`px-3 py-2 rounded-xl text-xs transition capitalize ${
                platformFilter === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Article list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message="No social mentions found" />
      ) : (
        <div className="space-y-2">
          {filtered.map(a => {
            const platform = getPlatform(a.ingestion_source || a.source_url || '')
            const colorClass = PLATFORM_COLORS[platform] || "bg-muted text-muted-foreground border-transparent"
            const isVideo = platform === 'youtube'
            return (
              <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/30 transition">
                {/* Thumbnail for YouTube */}
                {isVideo && a.image_url ? (
                  <div className="relative w-24 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                    <img src={a.image_url} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Play className="w-6 h-6 text-white" />
                    </div>
                  </div>
                ) : (
                  <span className={`flex-shrink-0 px-2 py-1 rounded-lg text-xs font-medium border ${colorClass}`}>
                    {platform === 'reddit' ? (a.source_name || 'reddit') : platform}
                  </span>
                )}

                <div className="flex-1 min-w-0">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-foreground hover:text-primary transition line-clamp-2">
                    {a.title}
                  </a>
                  {a.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    {a.author && <span className="text-xs text-muted-foreground">{a.author}</span>}
                    {a.published_at && (
                      <span className="text-xs text-muted-foreground">{format(new Date(a.published_at), "MMM d, yyyy HH:mm")}</span>
                    )}
                    {(a.engagement_score > 0) && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ThumbsUp className="w-3 h-3" /> {a.engagement_score}
                      </span>
                    )}
                    {(a.comment_count > 0) && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="w-3 h-3" /> {a.comment_count}
                      </span>
                    )}
                    {(a.matched_keywords ?? []).slice(0, 3).map((kw: string) => (
                      <span key={kw} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{kw}</span>
                    ))}
                  </div>
                </div>

                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  a.sentiment === 'positive' ? 'bg-emerald-500/15 text-emerald-400' :
                  a.sentiment === 'negative' ? 'bg-red-500/15 text-red-400' :
                  'bg-muted text-muted-foreground'
                }`}>{a.sentiment || "—"}</span>

                <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition flex-shrink-0">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}