import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFetch } from "@/hooks/useFetchContext";
import MetricCard from "@/components/MetricCard";
import SkeletonCard from "@/components/SkeletonCard";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format, subDays, formatDistanceToNow } from "date-fns";
import { ExternalLink, RefreshCw, Loader2, Star, Lock } from "lucide-react";
import WorldMap from "@/components/WorldMap";
import { isPaywalled } from "@/lib/paywallSources";

const CHART_COLORS = ["hsl(216,90%,66%)", "hsl(160,64%,55%)", "hsl(280,60%,60%)", "hsl(30,90%,60%)", "hsl(0,93%,71%)"];

export default function Dashboard() {
  const { fetching, result, startFetch } = useFetch();
  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["articles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("articles").select("*, sources(name, country_code)").neq("source_category", "social" as any).order("published_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  const { data: dashCounts } = useQuery({
    queryKey: ["dashboard-counts"],
    queryFn: async () => {
      const now = Date.now()
      const [{ count: todayCount }, { count: weekCount }, { count: totalCount }, { count: archiveCount }] = await Promise.all([
        supabase.from('articles').select('id', { count: 'exact', head: true }).gte('published_at', new Date(now - 24*60*60*1000).toISOString()),
        supabase.from('articles').select('id', { count: 'exact', head: true }).gte('published_at', new Date(now - 7*24*60*60*1000).toISOString()),
        supabase.from('articles').select('id', { count: 'exact', head: true }),
        supabase.from('articles').select('id', { count: 'exact', head: true }).lt('published_at', new Date(now - 30*24*60*60*1000).toISOString()),
      ])
      return { todayCount: todayCount ?? 0, weekCount: weekCount ?? 0, totalCount: totalCount ?? 0, archiveCount: archiveCount ?? 0 }
    },
    refetchInterval: 60000,
  });

  const { data: favKeywords } = useQuery({
    queryKey: ["keywords-favorites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("keywords").select("text, color_tag").eq("favorite", true).eq("active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: lastRun } = useQuery({
    queryKey: ["last-ingestion-run"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ingestion_runs")
        .select("completed_at")
        .eq("status", "success")
        .order("completed_at", { ascending: false })
        .limit(1)
        .single();
      return data;
    },
    refetchInterval: 60000,
  });

  const favArticles = useMemo(() => {
    if (!articles || !favKeywords?.length) return [];
    const favTexts = favKeywords.map(k => k.text);
    return articles
      .filter(a => a.matched_keywords?.some((kw: string) => favTexts.includes(kw)))
      .slice(0, 10);
  }, [articles, favKeywords]);

  const now = new Date();

  const todayCount = dashCounts?.todayCount ?? 0;
  const weekCount = dashCounts?.weekCount ?? 0;
  const totalCount = dashCounts?.totalCount ?? 0;
  const archiveCount = dashCounts?.archiveCount ?? 0;

  const lineData = Array.from({ length: 30 }, (_, i) => {
    const date = subDays(now, 29 - i);
    const dayStr = format(date, "yyyy-MM-dd");
    const count = articles?.filter(a => format(new Date(a.published_at), "yyyy-MM-dd") === dayStr).length ?? 0;
    return { date: format(date, "MMM d"), count };
  });

  const sourceCounts: Record<string, number> = {};
  articles?.forEach(a => {
    const name = (a.sources as any)?.name || (a as any).source_name || (a as any).source_domain || "Unknown";
    sourceCounts[name] = (sourceCounts[name] || 0) + 1;
  });
  const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
  const maxSourceCount = Math.max(...topSources.map(s => s.count), 1);

  const latest = articles?.slice(0, 10) ?? [];

  if (error) return <ErrorBanner message="Failed to load dashboard data." />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-light tracking-tight text-foreground">Dashboard</h1>
        <button
          onClick={startFetch}
          disabled={fetching}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition disabled:opacity-50 w-full sm:w-auto"
        >
          {fetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {fetching ? "Fetching…" : "Fetch Now"}
        </button>
      </div>
      {result && !fetching && (
        <div className={`px-4 py-2.5 rounded-xl text-xs ${result.startsWith("Error") ? "bg-negative/10 text-negative" : "bg-positive/10 text-positive"}`}>
          {result}
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        {isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <MetricCard label="Today" value={todayCount} subtitle="last 24h" />
            <MetricCard label="This Week" value={weekCount} subtitle="last 7d" />
            <MetricCard label="Total" value={totalCount} subtitle="all articles" />
            <MetricCard label="Archive" value={archiveCount} subtitle="older than 30d" />
          </>
        )}
      </div>

      {/* Last updated status */}
      <p className="text-[11px] text-muted-foreground">
        {lastRun?.completed_at
          ? `Last updated: ${formatDistanceToNow(new Date(lastRun.completed_at), { addSuffix: true })}`
          : "No fetch runs yet"}{" "}
        · Auto-updates at 6am, 12pm &amp; 6pm
      </p>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
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
                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-xs text-text-muted">
                      <span>{(a.sources as any)?.name || (a as any).source_name || (a as any).source_domain || "Unknown"}</span>
                      {isPaywalled((a as any).source_url || (a as any).source_domain) && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                          <Lock className="h-2.5 w-2.5" /> Subscription
                        </span>
                      )}
                      <span>· {format(new Date(a.published_at), "MMM d")}</span>
                    </div>
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

      {/* Favorite Keywords Mentions */}
      {favKeywords && favKeywords.length > 0 && (
        <div className="monitor-card">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
            <p className="section-label">Favorite Keyword Mentions</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {favKeywords.map(k => (
                <span key={k.text} className="px-2 py-0.5 rounded-full text-[10px] text-primary bg-primary/10">{k.text}</span>
              ))}
            </div>
          </div>
          {favArticles.length === 0 ? (
            <EmptyState message="No articles matching favorite keywords yet" />
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto">
              {favArticles.map(a => (
                <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-bg-elevated/50 transition group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-light truncate group-hover:text-primary transition">{a.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap text-xs text-text-muted">
                        <span>{(a.sources as any)?.name || (a as any).source_name || (a as any).source_domain || "Unknown"}</span>
                        {isPaywalled((a as any).source_url || (a as any).source_domain) && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                            <Lock className="h-2.5 w-2.5" /> Subscription
                          </span>
                        )}
                        <span>· {format(new Date(a.published_at), "MMM d")}</span>
                      </div>
                      {a.matched_keywords?.map((kw: string) => (
                        <span key={kw} className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">{kw}</span>
                      ))}
                    </div>
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
      )}
    </div>
  );
}
