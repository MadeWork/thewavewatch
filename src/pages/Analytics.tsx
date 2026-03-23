import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from "recharts";
import { format, subDays } from "date-fns";
import SkeletonCard from "@/components/SkeletonCard";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

const COLORS = ["hsl(216,90%,66%)", "hsl(160,64%,55%)", "hsl(0,93%,71%)", "hsl(30,90%,60%)", "hsl(280,60%,60%)"];

export default function Analytics() {
  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["analytics-articles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("articles").select("*, sources(name, region)").order("published_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const now = new Date();

  // Volume over time
  const volumeData = Array.from({ length: 30 }, (_, i) => {
    const date = subDays(now, 29 - i);
    const dayStr = format(date, "yyyy-MM-dd");
    const items = articles?.filter(a => format(new Date(a.published_at), "yyyy-MM-dd") === dayStr) ?? [];
    return {
      date: format(date, "MMM d"),
      total: items.length,
      positive: items.filter(a => a.sentiment === "positive").length,
      neutral: items.filter(a => a.sentiment === "neutral").length,
      negative: items.filter(a => a.sentiment === "negative").length,
    };
  });

  // Source distribution
  const sourceCounts: Record<string, number> = {};
  articles?.forEach(a => {
    const name = (a.sources as any)?.name || (a as any).source_name || (a as any).source_domain || "Unknown";
    sourceCounts[name] = (sourceCounts[name] || 0) + 1;
  });
  const sourceData = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));

  // Sentiment pie
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  articles?.forEach(a => {
    if (a.sentiment === "positive") sentimentCounts.positive++;
    else if (a.sentiment === "negative") sentimentCounts.negative++;
    else sentimentCounts.neutral++;
  });
  const pieData = [
    { name: "Positive", value: sentimentCounts.positive, color: "hsl(160,64%,55%)" },
    { name: "Neutral", value: sentimentCounts.neutral, color: "hsl(222,14%,60%)" },
    { name: "Negative", value: sentimentCounts.negative, color: "hsl(0,93%,71%)" },
  ];

  // Keyword performance
  const kwCounts: Record<string, number> = {};
  articles?.forEach(a => a.matched_keywords?.forEach((kw: string) => { kwCounts[kw] = (kwCounts[kw] || 0) + 1; }));
  const kwData = Object.entries(kwCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (error) return <ErrorBanner message="Failed to load analytics." />;

  const tooltipStyle = { background: "hsl(224,20%,18%)", border: "none", borderRadius: 12, color: "#fff", fontSize: 12 };

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-xl font-light tracking-tight text-foreground">Analytics</h1>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4">
          <SkeletonCard className="h-64" />
          <SkeletonCard className="h-64" />
          <SkeletonCard className="h-64" />
          <SkeletonCard className="h-64" />
        </div>
      ) : (
        <>
          {/* Volume + Sentiment stacked */}
          <div className="grid grid-cols-2 gap-4">
            <div className="monitor-card">
              <p className="section-label mb-4">Mention Volume — 30 Days</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={volumeData}>
                  <XAxis dataKey="date" tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} interval={6} />
                  <YAxis tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="total" stroke="hsl(216,90%,66%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="monitor-card">
              <p className="section-label mb-4">Sentiment Breakdown</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={volumeData}>
                  <XAxis dataKey="date" tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} interval={6} />
                  <YAxis tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="positive" stackId="s" fill="hsl(160,64%,55%)" radius={[0,0,0,0]} />
                  <Bar dataKey="neutral" stackId="s" fill="hsl(222,14%,60%)" />
                  <Bar dataKey="negative" stackId="s" fill="hsl(0,93%,71%)" radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Source distribution + Share of voice */}
          <div className="grid grid-cols-2 gap-4">
            <div className="monitor-card">
              <p className="section-label mb-4">Source Distribution</p>
              {sourceData.length === 0 ? <EmptyState message="No source data" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sourceData} layout="vertical">
                    <XAxis type="number" tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fill: "hsl(220,15%,80%)", fontSize: 10 }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" radius={[0,4,4,0]}>
                      {sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="monitor-card">
              <p className="section-label mb-4">Share of Voice</p>
              {articles?.length === 0 ? <EmptyState message="No data" /> : (
                <div className="flex items-center justify-center">
                  <ResponsiveContainer width={200} height={200}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={3}>
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
              )}
            </div>
          </div>

          {/* Keyword performance */}
          <div className="monitor-card">
            <p className="section-label mb-4">Keyword Performance</p>
            {kwData.length === 0 ? (
              <EmptyState message="No keyword matches yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left">
                      <th className="section-label pb-3 pr-4">Keyword</th>
                      <th className="section-label pb-3 pr-4">Matches</th>
                      <th className="section-label pb-3">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kwData.map(([kw, count]) => (
                      <tr key={kw} className="border-t border-bg-subtle">
                        <td className="py-2.5 pr-4 text-sm text-foreground font-light">{kw}</td>
                        <td className="py-2.5 pr-4 text-sm text-primary font-light">{count}</td>
                        <td className="py-2.5">
                          <div className="bar-track w-32">
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
        </>
      )}
    </div>
  );
}
