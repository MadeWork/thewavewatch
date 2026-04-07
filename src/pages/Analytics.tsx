import { useState, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { format, subDays } from "date-fns";
import { Download, TrendingUp, TrendingDown, Minus, FileText, BarChart3, Lock, Upload, RefreshCw, Rss } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import SkeletonCard from "@/components/SkeletonCard";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import WorldMap from "@/components/WorldMap";
import { isPaywalled } from "@/lib/paywallSources";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const COLORS = [
  "hsl(216,90%,66%)", "hsl(160,64%,55%)", "hsl(0,93%,71%)",
  "hsl(30,90%,60%)", "hsl(280,60%,60%)", "hsl(45,90%,60%)", "hsl(190,70%,50%)"
];

const TOOLTIP_STYLE = {
  background: "hsl(224,20%,18%)", border: "none",
  borderRadius: 12, color: "#fff", fontSize: 12
};

const COMPETITORS = [
  { name: "CorPower Ocean", terms: ["corpower", "corpowerocean", "corpower ocean"], color: "hsl(216,90%,66%)" },
  { name: "Minesto",        terms: ["minesto"],                                    color: "hsl(160,64%,55%)" },
  { name: "Orbital Marine", terms: ["orbital marine", "orbital power"],            color: "hsl(30,90%,60%)" },
  { name: "Eco Wave Power", terms: ["eco wave power", "ecowavepower"],             color: "hsl(280,60%,60%)" },
  { name: "Mocean Energy",  terms: ["mocean energy", "mocean"],                    color: "hsl(45,90%,60%)" },
  { name: "Carnegie",       terms: ["carnegie clean energy", "carnegie wave"],     color: "hsl(190,70%,50%)" },
];

type Period = "7d" | "30d" | "90d";
type Tab = "overview" | "sov" | "coverage" | "top_stories" | "owned" | "export";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function trend(current: number, previous: number): { pct: number; dir: "up" | "down" | "flat" } {
  if (previous === 0) return { pct: 0, dir: "flat" };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct: Math.abs(pct), dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  const { pct, dir } = trend(current, previous);
  if (dir === "flat") return <span className="text-[10px] text-text-muted flex items-center gap-1"><Minus className="w-3 h-3" /> —</span>;
  return (
    <span className={`text-[10px] flex items-center gap-1 ${dir === "up" ? "text-positive" : "text-negative"}`}>
      {dir === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {pct}% vs prev period
    </span>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function Insights() {
  const [period, setPeriod] = useState<Period>("30d");
  const [tab, setTab] = useState<Tab>("overview");
  const [exportRange, setExportRange] = useState<Period>("30d");

  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["insights-articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("*, sources(name, region, country_code)")
        .eq("is_duplicate", false)
        .order("published_at", { ascending: false })
        .limit(3000);
      if (error) throw error;
      return data as any[];
    },
  });

  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const now = new Date();
  const cutoff = subDays(now, days);
  const prevCutoff = subDays(now, days * 2);

  const periodArticles = useMemo(
    () => (articles ?? []).filter(a => a.published_at && new Date(a.published_at) >= cutoff),
    [articles, cutoff]
  );
  const prevPeriodArticles = useMemo(
    () => (articles ?? []).filter(a =>
      a.published_at &&
      new Date(a.published_at) >= prevCutoff &&
      new Date(a.published_at) < cutoff
    ),
    [articles, cutoff, prevCutoff]
  );

  // ── Volume over time
  const volumeData = useMemo(() => Array.from({ length: days }, (_, i) => {
    const date = subDays(now, days - 1 - i);
    const dayStr = format(date, "yyyy-MM-dd");
    const items = periodArticles.filter(a =>
      format(new Date(a.published_at), "yyyy-MM-dd") === dayStr
    );
    return {
      date: format(date, "MMM d"),
      total: items.length,
      positive: items.filter(a => a.sentiment === "positive").length,
      neutral: items.filter(a => a.sentiment === "neutral").length,
      negative: items.filter(a => a.sentiment === "negative").length,
    };
  }), [periodArticles, days]);

  // ── Sentiment
  const sentimentCounts = useMemo(() => {
    const s = { positive: 0, neutral: 0, negative: 0 };
    periodArticles.forEach(a => {
      if (a.sentiment === "positive") s.positive++;
      else if (a.sentiment === "negative") s.negative++;
      else s.neutral++;
    });
    return s;
  }, [periodArticles]);

  const prevSentiment = useMemo(() => {
    const s = { positive: 0, neutral: 0, negative: 0 };
    prevPeriodArticles.forEach(a => {
      if (a.sentiment === "positive") s.positive++;
      else if (a.sentiment === "negative") s.negative++;
      else s.neutral++;
    });
    return s;
  }, [prevPeriodArticles]);

  const pieData = [
    { name: "Positive", value: sentimentCounts.positive, color: "hsl(160,64%,55%)" },
    { name: "Neutral",  value: sentimentCounts.neutral,  color: "hsl(222,14%,60%)" },
    { name: "Negative", value: sentimentCounts.negative, color: "hsl(0,93%,71%)" },
  ];

  // ── Sources
  const sourceCounts = useMemo(() => {
    const s: Record<string, number> = {};
    periodArticles.forEach(a => {
      const name = (a.sources as any)?.name || a.source_name || a.source_url || "Unknown";
      s[name] = (s[name] || 0) + 1;
    });
    return s;
  }, [periodArticles]);

  const sourceData = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, value]) => ({ name, value }));

  // ── Countries
  const countryData = useMemo(() => {
    const c: Record<string, number> = {};
    periodArticles.forEach(a => {
      const cc = (a.sources as any)?.country_code || "Unknown";
      c[cc] = (c[cc] || 0) + 1;
    });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [periodArticles]);

  // ── Authors
  const topAuthors = useMemo(() => {
    const a: Record<string, number> = {};
    periodArticles.forEach(art => {
      const author = art.author || art.author_name;
      if (author && author.length > 2) a[author] = (a[author] || 0) + 1;
    });
    return Object.entries(a).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name, count }));
  }, [periodArticles]);

  // ── Keyword SOV
  const kwData = useMemo(() => {
    const kw: Record<string, number> = {};
    periodArticles.forEach(a =>
      (a.matched_keywords ?? []).forEach((k: string) => { kw[k] = (kw[k] || 0) + 1; })
    );
    const total = Object.values(kw).reduce((s, c) => s + c, 0);
    return { entries: Object.entries(kw).sort((a, b) => b[1] - a[1]).slice(0, 10), total };
  }, [periodArticles]);

  // ── Competitor Share of Voice
  const competitorSOV = useMemo(() => {
    return COMPETITORS.map(comp => {
      const count = periodArticles.filter(a => {
        const text = `${a.title ?? ""} ${a.description ?? ""}`.toLowerCase();
        return comp.terms.some(t => text.includes(t));
      }).length;
      const prevCount = prevPeriodArticles.filter(a => {
        const text = `${a.title ?? ""} ${a.description ?? ""}`.toLowerCase();
        return comp.terms.some(t => text.includes(t));
      }).length;
      return { ...comp, count, prevCount };
    }).sort((a, b) => b.count - a.count);
  }, [periodArticles, prevPeriodArticles]);

  const totalSOV = competitorSOV.reduce((s, c) => s + c.count, 0);

  // SOV over time
  const sovTimeData = useMemo(() => Array.from({ length: Math.min(days, 30) }, (_, i) => {
    const date = subDays(now, Math.min(days, 30) - 1 - i);
    const dayStr = format(date, "yyyy-MM-dd");
    const dayArticles = periodArticles.filter(a =>
      a.published_at && format(new Date(a.published_at), "yyyy-MM-dd") === dayStr
    );
    const point: Record<string, any> = { date: format(date, "MMM d") };
    COMPETITORS.forEach(comp => {
      point[comp.name] = dayArticles.filter(a => {
        const text = `${a.title ?? ""} ${a.description ?? ""}`.toLowerCase();
        return comp.terms.some(t => text.includes(t));
      }).length;
    });
    return point;
  }), [periodArticles, days]);

  // ── Top stories
  const topStories = useMemo(() =>
    [...periodArticles]
      .filter(a => a.relevance_label === "high" || a.is_major_outlet)
      .sort((a, b) => {
        const scoreA = (a.relevance_score ?? 0.5);
        const scoreB = (b.relevance_score ?? 0.5);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
      })
      .slice(0, 20),
    [periodArticles]
  );

  // ── Source quality
  const sourceQuality = sourceData.map(s => {
    const arts = periodArticles.filter(a =>
      ((a.sources as any)?.name || a.source_name || a.source_url) === s.name
    );
    const pos = arts.filter(a => a.sentiment === "positive").length;
    const posRate = pos / Math.max(arts.length, 1);
    return {
      name: s.name, articles: s.value,
      posRate: Math.round(posRate * 100),
      tier: posRate > 0.5 ? "High" : posRate > 0.25 ? "Medium" : "Low"
    };
  });

  // ── Export helpers
  const exportDays = exportRange === "7d" ? 7 : exportRange === "90d" ? 90 : 30;
  const exportCutoff = subDays(now, exportDays);
  const exportArticles = useMemo(
    () => (articles ?? []).filter(a => a.published_at && new Date(a.published_at) >= exportCutoff),
    [articles, exportCutoff]
  );

  const exportCSV = () => {
    const rows = [["Title", "Source", "Country", "Language", "Date", "Sentiment", "Relevance", "Keywords", "URL"]];
    exportArticles.forEach(a => {
      const src = a.sources as any;
      rows.push([
        a.title,
        src?.name || a.source_name || "",
        src?.country_code || "",
        a.language || "",
        a.published_at ? format(new Date(a.published_at), "yyyy-MM-dd") : "",
        a.sentiment || "",
        a.relevance_label || "",
        (a.matched_keywords ?? []).join("; "),
        a.url,
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `wavewatch-${exportRange}-${format(now, "yyyy-MM-dd")}.csv`;
    link.click();
  };

  const exportSummaryTXT = () => {
    const lines = [
      `WAVEWATCH MEDIA MONITORING REPORT`,
      `Period: Last ${exportDays} days (${format(exportCutoff, "MMM d")} – ${format(now, "MMM d, yyyy")})`,
      `Generated: ${format(now, "MMM d, yyyy HH:mm")}`,
      ``,
      `── COVERAGE SUMMARY ────────────────────────`,
      `Total mentions:   ${exportArticles.length}`,
      `Unique sources:   ${new Set(exportArticles.map(a => a.source_name || a.source_url)).size}`,
      ``,
      `── SENTIMENT ───────────────────────────────`,
      `Positive:  ${exportArticles.filter(a => a.sentiment === "positive").length}`,
      `Neutral:   ${exportArticles.filter(a => a.sentiment === "neutral").length}`,
      `Negative:  ${exportArticles.filter(a => a.sentiment === "negative").length}`,
      ``,
      `── SHARE OF VOICE ──────────────────────────`,
      ...COMPETITORS.map(c => {
        const n = exportArticles.filter(a => {
          const text = `${a.title ?? ""} ${a.description ?? ""}`.toLowerCase();
          return c.terms.some(t => text.includes(t));
        }).length;
        const total = COMPETITORS.reduce((s, cc) => s + exportArticles.filter(a => {
          const text = `${a.title ?? ""} ${a.description ?? ""}`.toLowerCase();
          return cc.terms.some(t => text.includes(t));
        }).length, 0);
        return `${c.name.padEnd(20)} ${n} mentions (${total > 0 ? Math.round((n / total) * 100) : 0}%)`;
      }),
      ``,
      `── TOP SOURCES ─────────────────────────────`,
      ...sourceData.slice(0, 8).map(s => `${s.name.padEnd(30)} ${s.value}`),
      ``,
      `── TOP STORIES ─────────────────────────────`,
      ...topStories.slice(0, 10).map((a, i) =>
        `${i + 1}. ${a.title}\n   ${a.source_name || ""} · ${a.published_at ? format(new Date(a.published_at), "MMM d") : ""} · ${a.sentiment || ""}\n   ${a.url}`
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `wavewatch-report-${format(now, "yyyy-MM-dd")}.txt`;
    link.click();
  };

  if (error) return <ErrorBanner message={(error as Error).message} />;

  const tickStyle = { fill: "hsl(222,14%,60%)", fontSize: 10 };
  const axisProps = { axisLine: false as const, tickLine: false as const };
  const interval = days > 30 ? Math.floor(days / 8) : days > 14 ? 3 : 1;

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-light tracking-tight text-foreground flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" /> Insights
        </h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-bg-elevated p-0.5">
            {(["7d", "30d", "90d"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs transition ${period === p ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-foreground"}`}>
                {p === "7d" ? "7 Days" : p === "30d" ? "30 Days" : "90 Days"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {([
          ["overview",   "Overview"],
          ["sov",        "Share of Voice"],
          ["coverage",   "Coverage"],
          ["top_stories","Top Stories"],
          ["export",     "Export"],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition -mb-px ${
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
          {tab === "overview" && (
            <div className="space-y-5">

              {/* KPI row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="monitor-card text-center">
                  <p className="section-label">Total Mentions</p>
                  <p className="text-2xl font-light text-primary mt-1">{periodArticles.length}</p>
                  <TrendBadge current={periodArticles.length} previous={prevPeriodArticles.length} />
                </div>
                <div className="monitor-card text-center">
                  <p className="section-label">Positive Sentiment</p>
                  <p className="text-2xl font-light text-positive mt-1">
                    {periodArticles.length > 0
                      ? Math.round((sentimentCounts.positive / periodArticles.length) * 100)
                      : 0}%
                  </p>
                  <TrendBadge current={sentimentCounts.positive} previous={prevSentiment.positive} />
                </div>
                <div className="monitor-card text-center">
                  <p className="section-label">Unique Sources</p>
                  <p className="text-2xl font-light text-foreground mt-1">
                    {Object.keys(sourceCounts).length}
                  </p>
                  <p className="text-[10px] text-text-muted">publishing about your topics</p>
                </div>
                <div className="monitor-card text-center">
                  <p className="section-label">CorPower Mentions</p>
                  <p className="text-2xl font-light text-primary mt-1">
                    {competitorSOV.find(c => c.name === "CorPower Ocean")?.count ?? 0}
                  </p>
                  <TrendBadge
                    current={competitorSOV.find(c => c.name === "CorPower Ocean")?.count ?? 0}
                    previous={competitorSOV.find(c => c.name === "CorPower Ocean")?.prevCount ?? 0}
                  />
                </div>
              </div>

              {/* Volume + Sentiment */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="monitor-card">
                  <p className="section-label mb-3">Mentions Over Time</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={volumeData}>
                      <XAxis dataKey="date" tick={tickStyle} {...axisProps} interval={interval} />
                      <YAxis tick={tickStyle} {...axisProps} width={30} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Area type="monotone" dataKey="total" stroke="hsl(216,90%,66%)" fill="hsl(216,90%,66%)" fillOpacity={0.15} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="monitor-card">
                  <p className="section-label mb-3">Sentiment Over Time</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={volumeData}>
                      <XAxis dataKey="date" tick={tickStyle} {...axisProps} interval={interval} />
                      <YAxis tick={tickStyle} {...axisProps} width={30} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Area type="monotone" dataKey="positive" stackId="1" stroke="hsl(160,64%,55%)" fill="hsl(160,64%,55%)" fillOpacity={0.3} />
                      <Area type="monotone" dataKey="neutral" stackId="1" stroke="hsl(222,14%,60%)" fill="hsl(222,14%,60%)" fillOpacity={0.2} />
                      <Area type="monotone" dataKey="negative" stackId="1" stroke="hsl(0,93%,71%)" fill="hsl(0,93%,71%)" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Sentiment pie + Country */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="monitor-card">
                  <p className="section-label mb-3">Sentiment Split</p>
                  <div className="flex items-center justify-center gap-4">
                    <ResponsiveContainer width={150} height={150}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" innerRadius={42} outerRadius={68} paddingAngle={3}>
                          {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2">
                      {pieData.map(p => (
                        <div key={p.name} className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                          <span className="text-xs text-text-secondary">{p.name}</span>
                          <span className="text-xs text-foreground font-medium">{p.value}</span>
                          <span className="text-[10px] text-text-muted">
                            ({periodArticles.length > 0 ? Math.round((p.value / periodArticles.length) * 100) : 0}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="monitor-card">
                  <p className="section-label mb-3">Geographic Distribution</p>
                  {countryData.length === 0 ? <EmptyState message="No country data" /> : (
                    <div className="space-y-2">
                      {countryData.map((c, i) => (
                        <div key={c.name} className="bar-row">
                          <div className="bar-dot" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="bar-label truncate">{c.name}</span>
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${(c.value / (countryData[0]?.value || 1)) * 100}%`, background: COLORS[i % COLORS.length] }} />
                          </div>
                          <span className="text-xs text-primary w-6 text-right">{c.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* World map */}
              <WorldMap articles={periodArticles} />
            </div>
          )}

          {/* ── SHARE OF VOICE TAB ───────────────────────────────────────── */}
          {tab === "sov" && (
            <div className="space-y-5">

              {/* SOV summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {competitorSOV.slice(0, 6).map(comp => (
                  <div key={comp.name} className="monitor-card">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: comp.color }} />
                      <p className="text-sm text-foreground">{comp.name}</p>
                    </div>
                    <p className="text-2xl font-light text-primary">{comp.count}</p>
                    <p className="text-[10px] text-text-muted">
                      {totalSOV > 0 ? Math.round((comp.count / totalSOV) * 100) : 0}% share of voice
                    </p>
                    <TrendBadge current={comp.count} previous={comp.prevCount} />
                  </div>
                ))}
              </div>

              {/* SOV bar chart */}
              <div className="monitor-card">
                <p className="section-label mb-3">Share of Voice — {days}-day period</p>
                {totalSOV === 0 ? (
                  <EmptyState message="No competitor mentions found in this period" />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart
                      data={competitorSOV.map(c => ({
                        name: c.name,
                        mentions: c.count,
                        sov: totalSOV > 0 ? Math.round((c.count / totalSOV) * 100) : 0,
                      }))}
                      layout="vertical"
                    >
                      <XAxis type="number" tick={tickStyle} {...axisProps} />
                      <YAxis type="category" dataKey="name" tick={tickStyle} {...axisProps} width={120} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: any, name: string) => [value, name === "mentions" ? "Mentions" : "SOV %"]} />
                      <Bar dataKey="mentions" radius={[0, 4, 4, 0]}>
                        {competitorSOV.map((c, i) => <Cell key={i} fill={c.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* SOV trend over time */}
              <div className="monitor-card">
                <p className="section-label mb-3">Share of Voice Over Time</p>
                {totalSOV === 0 ? <EmptyState message="No data" /> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={sovTimeData}>
                      <XAxis dataKey="date" tick={tickStyle} {...axisProps} interval={interval} />
                      <YAxis tick={tickStyle} {...axisProps} width={30} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend />
                      {COMPETITORS.map(c => (
                        <Line key={c.name} type="monotone" dataKey={c.name} stroke={c.color} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* SOV table */}
              <div className="monitor-card overflow-x-auto">
                <p className="section-label mb-3">Share of Voice Detail</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-text-muted text-xs border-b border-border">
                      <th className="text-left py-2 font-normal">Company</th>
                      <th className="text-right py-2 font-normal">Mentions</th>
                      <th className="text-right py-2 font-normal">SOV %</th>
                      <th className="text-right py-2 font-normal">vs Prev Period</th>
                      <th className="py-2 font-normal">Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {competitorSOV.map(c => (
                      <tr key={c.name} className="border-b border-border/50">
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                            <span className="text-foreground">{c.name}</span>
                          </div>
                        </td>
                        <td className="text-right text-foreground py-2">{c.count}</td>
                        <td className="text-right text-primary py-2">
                          {totalSOV > 0 ? Math.round((c.count / totalSOV) * 100) : 0}%
                        </td>
                        <td className="text-right py-2">
                          <TrendBadge current={c.count} previous={c.prevCount} />
                        </td>
                        <td className="py-2">
                          <div className="w-full bg-bg-elevated rounded-full h-2">
                            <div className="h-2 rounded-full" style={{
                              width: `${totalSOV > 0 ? (c.count / totalSOV) * 100 : 0}%`,
                              background: c.color
                            }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── COVERAGE TAB ─────────────────────────────────────────────── */}
          {tab === "coverage" && (
            <div className="space-y-5">

              {/* Top sources chart */}
              <div className="monitor-card">
                <p className="section-label mb-3">Top Sources by Volume</p>
                {sourceData.length === 0 ? <EmptyState message="No source data" /> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={sourceData} layout="vertical">
                      <XAxis type="number" tick={tickStyle} {...axisProps} />
                      <YAxis type="category" dataKey="name" tick={tickStyle} {...axisProps} width={140} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Keyword SOV + Source quality */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="monitor-card overflow-x-auto">
                  <p className="section-label mb-3">Keyword Performance</p>
                  {kwData.entries.length === 0 ? <EmptyState message="No keyword data" /> : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-text-muted text-xs border-b border-border">
                          <th className="text-left py-2 font-normal">Keyword</th>
                          <th className="text-right py-2 font-normal">Mentions</th>
                          <th className="text-right py-2 font-normal">Share</th>
                          <th className="py-2 font-normal">Bar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kwData.entries.map(([kw, count]) => (
                          <tr key={kw} className="border-b border-border/50">
                            <td className="py-2 text-foreground">{kw}</td>
                            <td className="text-right text-foreground py-2">{count}</td>
                            <td className="text-right text-primary py-2">
                              {kwData.total > 0 ? Math.round((count / kwData.total) * 100) : 0}%
                            </td>
                            <td className="py-2">
                              <div className="w-full bg-bg-elevated rounded-full h-2">
                                <div className="h-2 rounded-full bg-primary" style={{ width: `${kwData.total > 0 ? (count / kwData.total) * 100 : 0}%` }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="monitor-card overflow-x-auto">
                  <p className="section-label mb-3">Source Quality</p>
                  {sourceQuality.length === 0 ? <EmptyState message="No data" /> : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-text-muted text-xs border-b border-border">
                          <th className="text-left py-2 font-normal">Source</th>
                          <th className="text-right py-2 font-normal">Articles</th>
                          <th className="text-right py-2 font-normal">Positive%</th>
                          <th className="text-right py-2 font-normal">Tone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourceQuality.map(s => (
                          <tr key={s.name} className="border-b border-border/50">
                            <td className="py-2 text-foreground truncate max-w-[150px]">{s.name}</td>
                            <td className="text-right text-foreground py-2">{s.articles}</td>
                            <td className="text-right text-primary py-2">{s.posRate}%</td>
                            <td className="text-right py-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${s.tier === "High" ? "bg-positive/10 text-positive" : s.tier === "Medium" ? "bg-primary/10 text-primary" : "bg-bg-elevated text-text-muted"}`}>
                                {s.tier}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Authors */}
              <div className="monitor-card">
                <p className="section-label mb-3">Top Authors & Journalists</p>
                {topAuthors.length === 0 ? (
                  <EmptyState message="No author data available" />
                ) : (
                  <div className="space-y-2">
                    {topAuthors.map((a, i) => (
                      <div key={a.name} className="bar-row">
                        <div className="bar-dot" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="bar-label truncate">{a.name}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${(a.count / (topAuthors[0]?.count || 1)) * 100}%`, background: COLORS[i % COLORS.length] }} />
                        </div>
                        <span className="text-xs text-primary w-6 text-right">{a.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TOP STORIES TAB ──────────────────────────────────────────── */}
          {tab === "top_stories" && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                High-relevance articles from major outlets in the selected period, ranked by relevance score.
              </p>
              {topStories.length === 0 ? (
                <EmptyState message="No high-relevance stories found in this period" />
              ) : (
                topStories.map((a, i) => {
                  const src = a.sources as any;
                  const showPaywall = isPaywalled(a.source_url || a.source_domain);
                  return (
                    <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
                      className="monitor-card flex items-start gap-3 hover:bg-bg-elevated/80 transition group">
                      <span className="text-xs text-text-muted w-5 flex-shrink-0 pt-0.5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground font-light group-hover:text-primary transition">
                          {a.title}
                        </p>
                        {a.description && (
                          <p className="text-xs text-text-muted mt-1 line-clamp-2">{a.description}</p>
                        )}
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[10px] text-text-muted">
                          <span>{src?.name || a.source_name || "Unknown"}</span>
                          {showPaywall && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                              <Lock className="h-2.5 w-2.5" /> Subscription
                            </span>
                          )}
                          {a.published_at && <span>· {format(new Date(a.published_at), "MMM d, yyyy")}</span>}
                          {src?.country_code && <span>· {src.country_code}</span>}
                          {(a.matched_keywords ?? []).slice(0, 2).map((kw: string) => (
                            <span key={kw} className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{kw}</span>
                          ))}
                        </div>
                      </div>
                      <span className={`sentiment-badge text-[10px] flex-shrink-0 ${a.sentiment === "positive" ? "sentiment-positive" : a.sentiment === "negative" ? "sentiment-negative" : "sentiment-neutral"}`}>
                        {a.sentiment}
                      </span>
                    </a>
                  );
                })
              )}
            </div>
          )}

          {/* ── EXPORT TAB ───────────────────────────────────────────────── */}
          {tab === "export" && (
            <div className="space-y-5">
              <div className="monitor-card space-y-4">
                <p className="section-label">Export Options</p>
                <p className="text-xs text-text-muted">
                  Download your coverage data in multiple formats for board reports, presentations, or further analysis.
                </p>

                {/* Range selector */}
                <div className="space-y-2">
                  <p className="text-xs text-text-secondary">Date range</p>
                  <div className="flex rounded-xl bg-bg-elevated p-0.5 w-fit">
                    {(["7d", "30d", "90d"] as Period[]).map(p => (
                      <button key={p} onClick={() => setExportRange(p)}
                        className={`px-3 py-1.5 rounded-lg text-xs transition ${exportRange === p ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-foreground"}`}>
                        {p === "7d" ? "7 Days" : p === "30d" ? "30 Days" : "90 Days"}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-text-muted">
                    {exportArticles.length} articles in range ({format(exportCutoff, "MMM d")} – {format(now, "MMM d, yyyy")})
                  </p>
                </div>

                {/* Export buttons */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button onClick={exportCSV} className="flex items-center gap-3 p-4 rounded-xl bg-bg-elevated hover:bg-bg-subtle transition text-left">
                    <Download className="w-5 h-5 text-primary flex-shrink-0" />
                    <div>
                      <p className="text-sm text-foreground font-medium">CSV Export</p>
                      <p className="text-[10px] text-text-muted">All articles with metadata</p>
                    </div>
                  </button>
                  <button onClick={exportSummaryTXT} className="flex items-center gap-3 p-4 rounded-xl bg-bg-elevated hover:bg-bg-subtle transition text-left">
                    <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                    <div>
                      <p className="text-sm text-foreground font-medium">Summary Report</p>
                      <p className="text-[10px] text-text-muted">Board-ready text summary</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Preview of export summary */}
              <div className="monitor-card space-y-4">
                <p className="section-label">Report Preview</p>
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-text-muted">Period</p>
                      <p className="text-foreground mt-0.5">
                        {format(exportCutoff, "MMM d")} – {format(now, "MMM d, yyyy")}
                      </p>
                    </div>
                    <div>
                      <p className="text-text-muted">Total Mentions</p>
                      <p className="text-foreground mt-0.5 text-lg font-light">{exportArticles.length}</p>
                    </div>
                    <div>
                      <p className="text-text-muted">Unique Sources</p>
                      <p className="text-foreground mt-0.5 text-lg font-light">
                        {new Set(exportArticles.map(a => a.source_name || a.source_url)).size}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-text-muted mb-1">Sentiment</p>
                    <div className="flex gap-4">
                      {(["positive","neutral","negative"] as const).map(s => (
                        <div key={s}>
                          <p className="text-text-secondary capitalize">{s}</p>
                          <p className={`text-lg font-light ${s === "positive" ? "text-positive" : s === "negative" ? "text-negative" : "text-text-secondary"}`}>
                            {exportArticles.filter(a => a.sentiment === s).length}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-text-muted mb-1">Share of Voice</p>
                    <div className="space-y-1">
                      {competitorSOV.filter(c => c.count > 0).map(c => (
                        <div key={c.name} className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                          <span className="text-foreground">{c.name}</span>
                          <span className="text-primary">{c.count}</span>
                          <span className="text-text-muted">
                            ({totalSOV > 0 ? Math.round((c.count / totalSOV) * 100) : 0}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </>
      )}
    </div>
  );
}
