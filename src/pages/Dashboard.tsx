import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import MetricCard from "@/components/MetricCard";
import SkeletonCard from "@/components/SkeletonCard";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format, subDays, startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { ExternalLink, RefreshCw, Loader2, Star } from "lucide-react";
import WorldMap from "@/components/WorldMap";

const CHART_COLORS = ["hsl(216,90%,66%)", "hsl(160,64%,55%)", "hsl(280,60%,60%)", "hsl(30,90%,60%)", "hsl(0,93%,71%)"];

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["articles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("articles").select("*, sources(name, country_code)").order("published_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  // Favorite keywords + their articles
  const { data: favKeywords } = useQuery({
    queryKey: ["keywords-favorites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("keywords").select("text, color_tag").eq("favorite", true).eq("active", true);
      if (error) throw error;
      return data;
    },
  });

  const favArticles = useMemo(() => {
    if (!articles || !favKeywords?.length) return [];
    const favTexts = favKeywords.map(k => k.text);
    return articles
      .filter(a => a.matched_keywords?.some((kw: string) => favTexts.includes(kw)))
      .slice(0, 10);
  }, [articles, favKeywords]);

  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);

  const todayCount = articles?.filter(a => new Date(a.published_at) >= todayStart).length ?? 0;
  const weekCount = articles?.filter(a => new Date(a.published_at) >= weekStart).length ?? 0;
  const monthCount = articles?.filter(a => new Date(a.published_at) >= monthStart).length ?? 0;

  // Line chart: last 30 days
  const lineData = Array.from({ length: 30 }, (_, i) => {
    const date = subDays(now, 29 - i);
    const dayStr = format(date, "yyyy-MM-dd");
    const count = articles?.filter(a => format(new Date(a.published_at), "yyyy-MM-dd") === dayStr).length ?? 0;
    return { date: format(date, "MMM d"), count };
  });

  // Top sources
  const sourceCounts: Record<string, number> = {};
  articles?.forEach(a => {
    const name = (a.sources as any)?.name || "Unknown";
    sourceCounts[name] = (sourceCounts[name] || 0) + 1;
  });
  const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
  const maxSourceCount = Math.max(...topSources.map(s => s.count), 1);

  const latest = articles?.slice(0, 10) ?? [];

  if (error) return <ErrorBanner message="Failed to load dashboard data." />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-light tracking-tight text-foreground">Dashboard</h1>
        <button
          onClick={async () => {
            setFetching(true); setFetchResult(null);
            try {
              // Run discover-articles (Google News + domain feeds) as primary discovery
              const discoverResult = await supabase.functions.invoke("discover-articles", {
                body: { max_domains: 100 },
              });
              const disc = discoverResult.data;
              const discCount = disc?.discovered ?? 0;
              const totalCandidates = disc?.totalCandidates ?? 0;
              const newDomains = disc?.newDomainsFound ?? 0;

              // Then run fetch-rss for active source feeds
              const rssResult = await supabase.functions.invoke("fetch-rss", {
                body: { max_sources: 50 },
              });
              const rss = rssResult.data;
              const rssCount = rss?.totalInserted ?? 0;

              const parts: string[] = [];
              if (discCount > 0 || totalCandidates > 0) parts.push(`Discovered ${discCount} articles (${totalCandidates} candidates)`);
              if (rssCount > 0) parts.push(`${rssCount} from RSS feeds`);
              if (newDomains > 0) parts.push(`${newDomains} new sources found`);
              setFetchResult(parts.length > 0 ? parts.join(" · ") : "No new articles found matching your keywords");
              queryClient.invalidateQueries({ queryKey: ["articles"] });
              queryClient.invalidateQueries({ queryKey: ["mentions"] });
              queryClient.invalidateQueries({ queryKey: ["analytics-articles"] });
              queryClient.invalidateQueries({ queryKey: ["keywords"] });
            } catch (e: any) {
              setFetchResult(`Error: ${e.message}`);
            }
            setFetching(false);
          }}
          disabled={fetching}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {fetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {fetching ? "Fetching…" : "Fetch Now"}
        </button>
      </div>
      {fetchResult && (
        <div className={`px-4 py-2.5 rounded-xl text-xs ${fetchResult.startsWith("Error") ? "bg-negative/10 text-negative" : "bg-positive/10 text-positive"}`}>
          {fetchResult}
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <MetricCard label="Today" value={todayCount} subtitle="articles fetched" />
            <MetricCard label="This Week" value={weekCount} subtitle="articles fetched" />
            <MetricCard label="This Month" value={monthCount} subtitle="articles fetched" />
          </>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="monitor-card">
          <p className="section-label mb-4">Mentions — Last 30 Days</p>
          {isLoading ? (
            <div className="h-48 bg-bg-subtle rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={lineData}>
                <XAxis dataKey="date" tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} interval={6} />
                <YAxis tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={{ background: "hsl(224,20%,18%)", border: "none", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                <Line type="monotone" dataKey="count" stroke="hsl(216,90%,66%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="monitor-card">
          <p className="section-label mb-4">Top Sources</p>
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-4 bg-bg-subtle rounded animate-pulse" />)}
            </div>
          ) : topSources.length === 0 ? (
            <EmptyState message="No source data" />
          ) : (
            <div className="space-y-2">
              {topSources.map((s, i) => (
                <div key={s.name} className="bar-row">
                  <div className="bar-dot" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="bar-label truncate">{s.name}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(s.count / maxSourceCount) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  </div>
                  <span className="text-xs text-primary w-8 text-right font-light">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* World Map + Latest */}
      <div className="grid grid-cols-2 gap-4">
        <WorldMap articles={articles ?? []} />

        <div className="monitor-card">
          <p className="section-label mb-4">Latest Articles</p>
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-bg-subtle rounded-xl animate-pulse" />)}
            </div>
          ) : latest.length === 0 ? (
            <EmptyState message="No articles yet" />
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto">
              {latest.map(a => (
                <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-bg-elevated/50 transition group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-light truncate group-hover:text-primary transition">{a.title}</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {(a.sources as any)?.name} · {format(new Date(a.published_at), "MMM d")}
                    </p>
                  </div>
                  <span className={`sentiment-badge ${a.sentiment === 'positive' ? 'sentiment-positive' : a.sentiment === 'negative' ? 'sentiment-negative' : 'sentiment-neutral'}`}>
                    {a.sentiment}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition mt-0.5" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
