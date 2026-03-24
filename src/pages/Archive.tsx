import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subMonths, subYears } from "date-fns";
import { Archive as ArchiveIcon, Search, Download, ChevronLeft, ChevronRight, ExternalLink, TrendingUp } from "lucide-react";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const PAGE_SIZE = 25;

export default function Archive() {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sentiment, setSentiment] = useState("all");
  const [keyword, setKeyword] = useState("all");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(0);

  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["archive-articles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("articles").select("*, sources(name, country_code, region)").order("published_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: keywordTexts } = useQuery({
    queryKey: ["keywords-archive"],
    queryFn: async () => {
      const { data } = await supabase.from("keywords").select("text").eq("active", true);
      return data?.map(k => k.text) ?? [];
    },
  });

  const allSources = useMemo(() => {
    const s = new Set<string>();
    (articles ?? []).forEach(a => { const n = (a.sources as any)?.name || a.source_name; if (n) s.add(n); });
    return Array.from(s).sort();
  }, [articles]);

  const allKeywords = useMemo(() => {
    const kws = new Set<string>();
    (articles ?? []).forEach(a => a.matched_keywords?.forEach((k: string) => kws.add(k)));
    if (keywordTexts) keywordTexts.forEach(k => kws.add(k));
    return Array.from(kws).sort();
  }, [articles, keywordTexts]);

  const filtered = useMemo(() => {
    let result = articles ?? [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a => a.title.toLowerCase().includes(q) || a.snippet?.toLowerCase().includes(q) || a.url.toLowerCase().includes(q));
    }
    if (dateFrom) result = result.filter(a => new Date(a.published_at) >= new Date(dateFrom));
    if (dateTo) result = result.filter(a => new Date(a.published_at) <= new Date(dateTo + "T23:59:59"));
    if (sentiment !== "all") result = result.filter(a => a.sentiment === sentiment);
    if (keyword !== "all") result = result.filter(a => a.matched_keywords?.includes(keyword));
    if (source !== "all") result = result.filter(a => ((a.sources as any)?.name || a.source_name) === source);
    return result;
  }, [articles, search, dateFrom, dateTo, sentiment, keyword, source]);

  // Trend data for filtered results
  const trendData = useMemo(() => {
    if (filtered.length === 0) return [];
    const counts: Record<string, number> = {};
    filtered.forEach(a => {
      const d = format(new Date(a.published_at), "yyyy-MM-dd");
      counts[d] = (counts[d] || 0) + 1;
    });
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).slice(-60).map(([date, count]) => ({
      date: format(new Date(date), "MMM d"),
      count,
    }));
  }, [filtered]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const exportCSV = () => {
    const rows = [["Title", "Source", "Date", "Sentiment", "Keywords", "URL"]];
    filtered.forEach(a => {
      rows.push([a.title, (a.sources as any)?.name || a.source_name || "", format(new Date(a.published_at), "yyyy-MM-dd"), a.sentiment || "", (a.matched_keywords || []).join("; "), a.url]);
    });
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "archive-export.csv"; link.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <ErrorBanner message="Failed to load archive." />;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-light tracking-tight text-foreground flex items-center gap-2">
          <ArchiveIcon className="w-5 h-5 text-primary" /> Archive
        </h1>
        <button onClick={exportCSV} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-bg-elevated text-text-secondary text-xs hover:bg-bg-subtle transition">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Search + Filters */}
      <div className="monitor-card space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search archive…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">From</p>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }}
              className="w-full px-2 py-1.5 rounded-lg bg-bg-elevated border border-bg-subtle text-foreground text-xs" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">To</p>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }}
              className="w-full px-2 py-1.5 rounded-lg bg-bg-elevated border border-bg-subtle text-foreground text-xs" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Sentiment</p>
            <select value={sentiment} onChange={e => { setSentiment(e.target.value); setPage(0); }}
              className="w-full px-2 py-1.5 rounded-lg bg-bg-elevated border border-bg-subtle text-foreground text-xs">
              <option value="all">All</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </select>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Keyword</p>
            <select value={keyword} onChange={e => { setKeyword(e.target.value); setPage(0); }}
              className="w-full px-2 py-1.5 rounded-lg bg-bg-elevated border border-bg-subtle text-foreground text-xs">
              <option value="all">All Keywords</option>
              {allKeywords.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Source</p>
            <select value={source} onChange={e => { setSource(e.target.value); setPage(0); }}
              className="w-full px-2 py-1.5 rounded-lg bg-bg-elevated border border-bg-subtle text-foreground text-xs">
              <option value="all">All Sources</option>
              {allSources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-text-muted">{filtered.length} articles found</p>
      </div>

      {/* Trend chart */}
      {trendData.length > 3 && (
        <div className="monitor-card">
          <p className="section-label mb-3 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Historical Trend</p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={trendData}>
              <XAxis dataKey="date" tick={{ fill: "hsl(222,14%,60%)", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(trendData.length / 8))} />
              <YAxis tick={{ fill: "hsl(222,14%,60%)", fontSize: 9 }} axisLine={false} tickLine={false} width={25} />
              <Tooltip contentStyle={{ background: "hsl(224,20%,18%)", border: "none", borderRadius: 12, color: "#fff", fontSize: 12 }} />
              <Line type="monotone" dataKey="count" stroke="hsl(216,90%,66%)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="monitor-card animate-pulse h-16" />)}</div>
      ) : paged.length === 0 ? (
        <EmptyState message="No articles found in archive" />
      ) : (
        <div className="space-y-1.5">
          {paged.map(a => {
            const displayName = (a.sources as any)?.name || a.source_name || a.source_domain || "Unknown";
            return (
              <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
                className="monitor-card flex items-start gap-3 hover:bg-bg-elevated/80 transition group py-3 px-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-light group-hover:text-primary transition truncate">{a.title}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-text-secondary">{displayName}</span>
                    <span className="text-xs text-text-muted">{format(new Date(a.published_at), "MMM d, yyyy")}</span>
                    {a.matched_keywords?.slice(0, 3).map((kw: string) => (
                      <span key={kw} className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">{kw}</span>
                    ))}
                  </div>
                </div>
                <span className={`sentiment-badge flex-shrink-0 text-[10px] ${a.sentiment === "positive" ? "sentiment-positive" : a.sentiment === "negative" ? "sentiment-negative" : "sentiment-neutral"}`}>
                  {a.sentiment}
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition mt-1" />
              </a>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-2 rounded-xl bg-bg-elevated text-text-secondary hover:bg-bg-subtle disabled:opacity-30 transition">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-text-muted">{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-2 rounded-xl bg-bg-elevated text-text-secondary hover:bg-bg-subtle disabled:opacity-30 transition">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
