import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Plus, Trash2, Download, BarChart3, TrendingUp, Sparkles } from "lucide-react";
import { useReportTemplates } from "@/hooks/useArticleActions";
import { format, subDays } from "date-fns";
import EmptyState from "@/components/EmptyState";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

const COLORS = ["hsl(216,90%,66%)", "hsl(160,64%,55%)", "hsl(0,93%,71%)", "hsl(30,90%,60%)", "hsl(280,60%,60%)"];

export default function Reports() {
  const { templates, isLoading, addTemplate, deleteTemplate } = useReportTemplates();
  const [showCreate, setShowCreate] = useState(false);
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", dateRange: "7d", keywords: [] as string[], schedule: "" });

  const { data: articles } = useQuery({
    queryKey: ["report-articles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("articles").select("*, sources(name, country_code, region)").order("published_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: keywords } = useQuery({
    queryKey: ["keywords-report"],
    queryFn: async () => {
      const { data } = await supabase.from("keywords").select("text").eq("active", true);
      return data?.map(k => k.text) ?? [];
    },
  });

  const handleCreate = () => {
    if (!form.name.trim()) return;
    addTemplate({ name: form.name.trim(), description: form.description, filters: { dateRange: form.dateRange, keywords: form.keywords }, schedule: form.schedule || undefined });
    setForm({ name: "", description: "", dateRange: "7d", keywords: [], schedule: "" });
    setShowCreate(false);
  };

  // Report data generation
  const reportData = useMemo(() => {
    if (!articles) return null;
    const now = new Date();
    const cutoff = subDays(now, 7);
    const recent = articles.filter(a => new Date(a.published_at) >= cutoff);

    const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
    recent.forEach(a => {
      if (a.sentiment === "positive") sentimentCounts.positive++;
      else if (a.sentiment === "negative") sentimentCounts.negative++;
      else sentimentCounts.neutral++;
    });

    const sourceCounts: Record<string, number> = {};
    recent.forEach(a => {
      const name = (a.sources as any)?.name || a.source_name || a.source_domain || "Unknown";
      sourceCounts[name] = (sourceCounts[name] || 0) + 1;
    });
    const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, value]) => ({ name, value }));

    const kwCounts: Record<string, number> = {};
    recent.forEach(a => a.matched_keywords?.forEach((kw: string) => { kwCounts[kw] = (kwCounts[kw] || 0) + 1; }));

    const dailyVolume = Array.from({ length: 7 }, (_, i) => {
      const date = subDays(now, 6 - i);
      const dayStr = format(date, "yyyy-MM-dd");
      return { date: format(date, "EEE"), count: recent.filter(a => format(new Date(a.published_at), "yyyy-MM-dd") === dayStr).length };
    });

    return { total: recent.length, sentimentCounts, topSources, kwCounts, dailyVolume, topArticles: recent.slice(0, 5) };
  }, [articles]);

  const exportReportCSV = () => {
    if (!reportData) return;
    const rows = [["Metric", "Value"]];
    rows.push(["Total Mentions (7d)", String(reportData.total)]);
    rows.push(["Positive", String(reportData.sentimentCounts.positive)]);
    rows.push(["Neutral", String(reportData.sentimentCounts.neutral)]);
    rows.push(["Negative", String(reportData.sentimentCounts.negative)]);
    rows.push([], ["Top Sources", "Count"]);
    reportData.topSources.forEach(s => rows.push([s.name, String(s.value)]));
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `report-${format(new Date(), "yyyy-MM-dd")}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  const pieData = reportData ? [
    { name: "Positive", value: reportData.sentimentCounts.positive, color: "hsl(160,64%,55%)" },
    { name: "Neutral", value: reportData.sentimentCounts.neutral, color: "hsl(222,14%,60%)" },
    { name: "Negative", value: reportData.sentimentCounts.negative, color: "hsl(0,93%,71%)" },
  ] : [];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-light tracking-tight text-foreground flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" /> Reports
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={exportReportCSV} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-bg-elevated text-text-secondary text-xs hover:bg-bg-subtle transition">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition">
            <Plus className="w-3.5 h-3.5" /> New Report
          </button>
        </div>
      </div>

      {/* Create report */}
      {showCreate && (
        <div className="monitor-card space-y-3">
          <p className="section-label">Create Report Template</p>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Report name…"
            className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)…"
            className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 rounded-xl bg-bg-elevated text-text-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Saved templates */}
      {templates.length > 0 && (
        <div className="space-y-2">
          <p className="section-label">Saved Reports</p>
          {templates.map((t: any) => (
            <div key={t.id} className="monitor-card flex items-center gap-4 cursor-pointer hover:bg-bg-elevated/80 transition" onClick={() => setActiveReport(t.id === activeReport ? null : t.id)}>
              <FileText className="w-4 h-4 text-primary flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-foreground">{t.name}</p>
                {t.description && <p className="text-xs text-text-muted">{t.description}</p>}
              </div>
              <button onClick={e => { e.stopPropagation(); deleteTemplate(t.id); }} className="p-2 rounded-lg text-text-muted hover:text-negative hover:bg-negative/10 transition">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Live report dashboard */}
      {reportData && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="monitor-card text-center">
              <p className="section-label">Total Mentions</p>
              <p className="text-2xl font-light text-primary mt-1">{reportData.total}</p>
              <p className="text-[10px] text-text-muted">Last 7 days</p>
            </div>
            <div className="monitor-card text-center">
              <p className="section-label">Positive</p>
              <p className="text-2xl font-light text-positive mt-1">{reportData.sentimentCounts.positive}</p>
              <p className="text-[10px] text-text-muted">{reportData.total > 0 ? Math.round((reportData.sentimentCounts.positive / reportData.total) * 100) : 0}%</p>
            </div>
            <div className="monitor-card text-center">
              <p className="section-label">Neutral</p>
              <p className="text-2xl font-light text-text-secondary mt-1">{reportData.sentimentCounts.neutral}</p>
              <p className="text-[10px] text-text-muted">{reportData.total > 0 ? Math.round((reportData.sentimentCounts.neutral / reportData.total) * 100) : 0}%</p>
            </div>
            <div className="monitor-card text-center">
              <p className="section-label">Negative</p>
              <p className="text-2xl font-light text-negative mt-1">{reportData.sentimentCounts.negative}</p>
              <p className="text-[10px] text-text-muted">{reportData.total > 0 ? Math.round((reportData.sentimentCounts.negative / reportData.total) * 100) : 0}%</p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-4">
            <div className="monitor-card">
              <p className="section-label mb-3 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Daily Volume</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={reportData.dailyVolume}>
                  <XAxis dataKey="date" tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(222,14%,60%)", fontSize: 10 }} axisLine={false} tickLine={false} width={25} />
                  <Tooltip contentStyle={{ background: "hsl(224,20%,18%)", border: "none", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill="hsl(216,90%,66%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="monitor-card">
              <p className="section-label mb-3">Sentiment Split</p>
              <div className="flex items-center justify-center">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={3}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 ml-4">
                  {pieData.map(p => (
                    <div key={p.name} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                      <span className="text-xs text-text-secondary">{p.name}: {p.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Top sources + top articles */}
          <div className="grid grid-cols-2 gap-4">
            <div className="monitor-card">
              <p className="section-label mb-3">Top Sources</p>
              {reportData.topSources.length === 0 ? <EmptyState message="No sources" /> : (
                <div className="space-y-2">
                  {reportData.topSources.map((s, i) => (
                    <div key={s.name} className="bar-row">
                      <div className="bar-dot" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="bar-label truncate">{s.name}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(s.value / (reportData.topSources[0]?.value || 1)) * 100}%`, background: COLORS[i % COLORS.length] }} />
                      </div>
                      <span className="text-xs text-primary w-6 text-right">{s.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="monitor-card">
              <p className="section-label mb-3">Top Articles</p>
              {reportData.topArticles.length === 0 ? <EmptyState message="No articles" /> : (
                <div className="space-y-2">
                  {reportData.topArticles.map(a => (
                    <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 p-2 rounded-lg hover:bg-bg-elevated/50 transition group">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground font-light truncate group-hover:text-primary">{a.title}</p>
                        <p className="text-[10px] text-text-muted mt-0.5">{(a.sources as any)?.name || a.source_name || "Unknown"} · {format(new Date(a.published_at), "MMM d")}</p>
                      </div>
                      <span className={`sentiment-badge text-[10px] ${a.sentiment === "positive" ? "sentiment-positive" : a.sentiment === "negative" ? "sentiment-negative" : "sentiment-neutral"}`}>{a.sentiment}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
