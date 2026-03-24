import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { format, subDays, subMonths } from "date-fns";
import SkeletonCard from "@/components/SkeletonCard";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import MetricCard from "@/components/MetricCard";
import WorldMap from "@/components/WorldMap";

const COLORS = ["hsl(216,90%,66%)", "hsl(160,64%,55%)", "hsl(0,93%,71%)", "hsl(30,90%,60%)", "hsl(280,60%,60%)", "hsl(45,90%,60%)", "hsl(190,70%,50%)"];

export default function Analytics() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");

  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["analytics-articles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("articles").select("*, sources(name, region, country_code)").order("published_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return data as any[];
    },
  });

  const now = new Date();
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const cutoff = subDays(now, days);
  const periodArticles = useMemo(() => (articles ?? []).filter(a => new Date(a.published_at) >= cutoff), [articles, cutoff]);

  // Volume over time
  const volumeData = useMemo(() => Array.from({ length: days }, (_, i) => {
    const date = subDays(now, days - 1 - i);
    const dayStr = format(date, "yyyy-MM-dd");
    const items = periodArticles.filter(a => format(new Date(a.published_at), "yyyy-MM-dd") === dayStr);
    return {
      date: format(date, days > 30 ? "MMM d" : "MMM d"),
      total: items.length,
      positive: items.filter(a => a.sentiment === "positive").length,
      neutral: items.filter(a => a.sentiment === "neutral").length,
      negative: items.filter(a => a.sentiment === "negative").length,
    };
  }), [periodArticles, days]);

  // Source distribution
  const sourceCounts: Record<string, number> = {};
  periodArticles.forEach(a => {
    const name = (a.sources as any)?.name || a.source_name || a.source_domain || "Unknown";
    sourceCounts[name] = (sourceCounts[name] || 0) + 1;
  });
  const sourceData = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value }));

  // Author tracking
  const authorCounts: Record<string, number> = {};
  periodArticles.forEach(a => {
    if (a.author_name) authorCounts[a.author_name] = (authorCounts[a.author_name] || 0) + 1;
  });
  const topAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));

  // Sentiment totals
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  periodArticles.forEach(a => {
    if (a.sentiment === "positive") sentimentCounts.positive++;
    else if (a.sentiment === "negative") sentimentCounts.negative++;
    else sentimentCounts.neutral++;
  });
  const pieData = [
    { name: "Positive", value: sentimentCounts.positive, color: "hsl(160,64%,55%)" },
    { name: "Neutral", value: sentimentCounts.neutral, color: "hsl(222,14%,60%)" },
    { name: "Negative", value: sentimentCounts.negative, color: "hsl(0,93%,71%)" },
  ];

  // Country distribution
  const countryCounts: Record<string, number> = {};
  periodArticles.forEach(a => {
    const cc = (a.sources as any)?.country_code || "Unknown";
    countryCounts[cc] = (countryCounts[cc] || 0) + 1;
  });
  const countryData = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value }));

  // Keyword performance (share of voice)
  const kwCounts: Record<string, number> = {};
  periodArticles.forEach(a => a.matched_keywords?.forEach((kw: string) => { kwCounts[kw] = (kwCounts[kw] || 0) + 1; }));
  const kwData = Object.entries(kwCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const totalKwMentions = kwData.reduce((s, [, c]) => s + c, 0);

  // Source quality tiers
  const sourceQuality = sourceData.map(s => {
    const arts = periodArticles.filter(a => ((a.sources as any)?.name || a.source_name || a.source_domain) === s.name);
    const posRate = arts.filter(a => a.sentiment === "positive").length / Math.max(arts.length, 1);
    return { name: s.name, articles: s.value, tier: posRate > 0.5 ? "High" : posRate > 0.25 ? "Medium" : "Low", posRate: Math.round(posRate * 100) };
  });

  if (error) return <ErrorBanner message="Failed to load analytics." />;

  const tooltipStyle = { background: "hsl(224,20%,18%)", border: "none", borderRadius: 12, color: "#fff", fontSize: 12 };
  const interval = days > 30 ? Math.floor(days / 8) : days > 14 ? 3 : 1;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-light tracking-tight text-foreground">Analytics</h1>
        <div className="segment-control max-w-xs">
          {(["7d", "30d", "90d"] as const).map(p => (
            <button key={p} className={`segment-btn ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>{p === "7d" ? "7 Days" : p === "30d" ? "30 Days" : "90 Days"}</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4"><SkeletonCard className="h-64" /><SkeletonCard className="h-64" /><SkeletonCard className="h-64" /><SkeletonCard className="h-64" /></div>
      ) : (
        <>
          {/* Summary metrics */}
          <div className="grid grid-cols-4 gap-4">
            <MetricCard label="Total Mentions" value={periodArticles.length} subtitle={`${days}-day period`} />
            <MetricCard label="Positive" value={sentimentCounts.positive} subtitle={`${periodArticles.length ? Math.round((sentimentCounts.positive / periodArticles.length) * 100) : 0}% of total`} />
            <MetricCard label="Negative" value={sentimentCounts.negative} subtitle={`${periodArticles.length ? Math.round((sentimentCounts.negative / periodArticles.length) * 100) : 0}% of total`} />
            <MetricCard label="Sources" value={Object.keys(sourceCounts).length} subtitle="unique sources" />
          </div>

          {/* Volume + Sentiment stacked */}
          <div className="grid grid-cols-2 gap-4">
            <div className="monitor-card">
              <p className="section-label mb-4">Mentions Over Time</p>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={volumeData}>
                  <XAxis dataKey="date" tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} interval={interval} />
                  <YAxis tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="total" stroke="hsl(216,90%,66%)" fill="hsl(216,90%,66%)" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="monitor-card">
              <p className="section-label mb-4">Sentiment Over Time</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={volumeData}>
                  <XAxis dataKey="date" tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} interval={interval} />
                  <YAxis tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="positive" stackId="s" fill="hsl(160,64%,55%)" />
                  <Bar dataKey="neutral" stackId="s" fill="hsl(222,14%,60%)" />
                  <Bar dataKey="negative" stackId="s" fill="hsl(0,93%,71%)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Source distribution + SOV pie */}
          <div className="grid grid-cols-2 gap-4">
            <div className="monitor-card">
              <p className="section-label mb-4">Top Sources</p>
              {sourceData.length === 0 ? <EmptyState message="No data" /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={sourceData} layout="vertical">
                    <XAxis type="number" tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fill: "hsl(220,15%,80%)", fontSize: 10 }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="monitor-card">
              <p className="section-label mb-4">Share of Voice (Sentiment)</p>
              <div className="flex items-center justify-center">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={3}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 ml-4">
                  {pieData.map(p => (
                    <div key={p.name} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                      <span className="text-xs text-text-secondary">{p.name}</span>
                      <span className="text-xs text-primary font-light">{p.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Country distribution + Authors */}
          <div className="grid grid-cols-2 gap-4">
            <div className="monitor-card">
              <p className="section-label mb-4">Country/Region Distribution</p>
              {countryData.length === 0 ? <EmptyState message="No data" /> : (
                <div className="space-y-2">
                  {countryData.map((c, i) => (
                    <div key={c.name} className="bar-row">
                      <div className="bar-dot" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="bar-label">{c.name}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(c.value / (countryData[0]?.value || 1)) * 100}%`, background: COLORS[i % COLORS.length] }} />
                      </div>
                      <span className="text-xs text-primary w-6 text-right font-light">{c.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="monitor-card">
              <p className="section-label mb-4">Top Authors / Journalists</p>
              {topAuthors.length === 0 ? <EmptyState message="Run Deep Scan to extract author data" /> : (
                <div className="space-y-2">
                  {topAuthors.map((a, i) => (
                    <div key={a.name} className="bar-row">
                      <div className="bar-dot" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="bar-label truncate">{a.name}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(a.count / (topAuthors[0]?.count || 1)) * 100}%`, background: COLORS[i % COLORS.length] }} />
                      </div>
                      <span className="text-xs text-primary w-6 text-right font-light">{a.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Keyword SOV + Source Quality */}
          <div className="grid grid-cols-2 gap-4">
            <div className="monitor-card">
              <p className="section-label mb-4">Keyword Share of Voice</p>
              {kwData.length === 0 ? <EmptyState message="No keyword data" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left">
                        <th className="section-label pb-3 pr-4">Keyword</th>
                        <th className="section-label pb-3 pr-4">Mentions</th>
                        <th className="section-label pb-3 pr-4">SOV %</th>
                        <th className="section-label pb-3">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kwData.map(([kw, count]) => (
                        <tr key={kw} className="border-t border-bg-subtle">
                          <td className="py-2 pr-4 text-sm text-foreground font-light">{kw}</td>
                          <td className="py-2 pr-4 text-sm text-primary font-light">{count}</td>
                          <td className="py-2 pr-4 text-sm text-text-secondary font-light">{totalKwMentions ? Math.round((count / totalKwMentions) * 100) : 0}%</td>
                          <td className="py-2">
                            <div className="bar-track w-24">
                              <div className="bar-fill bg-primary" style={{ width: `${(count / (kwData[0]?.[1] || 1)) * 100}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="monitor-card">
              <p className="section-label mb-4">Source Quality Tiers</p>
              {sourceQuality.length === 0 ? <EmptyState message="No data" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left">
                        <th className="section-label pb-3 pr-4">Source</th>
                        <th className="section-label pb-3 pr-4">Articles</th>
                        <th className="section-label pb-3 pr-4">Positive %</th>
                        <th className="section-label pb-3">Tier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceQuality.map(s => (
                        <tr key={s.name} className="border-t border-bg-subtle">
                          <td className="py-2 pr-4 text-sm text-foreground font-light truncate max-w-[120px]">{s.name}</td>
                          <td className="py-2 pr-4 text-sm text-primary font-light">{s.articles}</td>
                          <td className="py-2 pr-4 text-sm text-text-secondary font-light">{s.posRate}%</td>
                          <td className="py-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] ${s.tier === "High" ? "bg-positive/15 text-positive" : s.tier === "Medium" ? "bg-primary/15 text-primary" : "bg-negative/15 text-negative"}`}>{s.tier}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* World Map */}
          <WorldMap articles={periodArticles} />
        </>
      )}
    </div>
  );
}
