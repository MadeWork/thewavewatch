import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Search, Download, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

const PAGE_SIZE = 20;
const REGIONS = ["all", "wire", "press", "business", "nordics"];
const SENTIMENTS = ["all", "positive", "neutral", "negative"];

export default function Mentions() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [sentiment, setSentiment] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");

  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["mentions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("articles").select("*, sources(name, region, country_code)").order("published_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    let result = articles ?? [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a => a.title.toLowerCase().includes(q) || a.snippet?.toLowerCase().includes(q));
    }
    if (region !== "all") result = result.filter(a => (a.sources as any)?.region === region);
    if (sentiment !== "all") result = result.filter(a => a.sentiment === sentiment);
    if (sortBy === "oldest") result = [...result].reverse();
    return result;
  }, [articles, search, region, sentiment, sortBy]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const exportCSV = () => {
    const rows = [["Title", "Source", "Date", "Sentiment", "URL"]];
    filtered.forEach(a => rows.push([a.title, (a.sources as any)?.name || "", format(new Date(a.published_at), "yyyy-MM-dd"), a.sentiment || "", a.url]));
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "mentions-export.csv"; link.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <ErrorBanner message="Failed to load mentions." />;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-light tracking-tight text-foreground">Mentions Feed</h1>
        <button onClick={exportCSV} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-bg-elevated text-text-secondary text-xs hover:bg-bg-subtle transition">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="monitor-card space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search articles…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
        </div>
        <div className="flex gap-4 flex-wrap">
          <div>
            <p className="section-label mb-1.5">Region</p>
            <div className="segment-control">
              {REGIONS.map(r => (
                <button key={r} className={`segment-btn ${region === r ? 'active' : ''}`} onClick={() => { setRegion(r); setPage(0); }}>
                  {r === "all" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="section-label mb-1.5">Sentiment</p>
            <div className="segment-control">
              {SENTIMENTS.map(s => (
                <button key={s} className={`segment-btn ${sentiment === s ? 'active' : ''}`} onClick={() => { setSentiment(s); setPage(0); }}>
                  {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="section-label mb-1.5">Sort</p>
            <div className="segment-control">
              <button className={`segment-btn ${sortBy === 'newest' ? 'active' : ''}`} onClick={() => setSortBy("newest")}>Newest</button>
              <button className={`segment-btn ${sortBy === 'oldest' ? 'active' : ''}`} onClick={() => setSortBy("oldest")}>Oldest</button>
            </div>
          </div>
        </div>
      </div>

      {/* Articles */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="monitor-card animate-pulse">
              <div className="h-4 w-3/4 bg-bg-subtle rounded mb-2" />
              <div className="h-3 w-1/2 bg-bg-subtle rounded" />
            </div>
          ))}
        </div>
      ) : paged.length === 0 ? (
        <EmptyState message="No articles match your filters" />
      ) : (
        <div className="space-y-2">
          {paged.map(a => (
            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
              className="monitor-card flex items-start gap-4 hover:bg-bg-elevated/80 transition group cursor-pointer">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground font-light group-hover:text-primary transition">{a.title}</p>
                {a.snippet && <p className="text-xs text-text-muted mt-1 line-clamp-2">{a.snippet}</p>}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-xs text-text-secondary">{(a.sources as any)?.name}</span>
                  <span className="text-xs text-text-muted">·</span>
                  <span className="text-xs text-text-muted">{format(new Date(a.published_at), "MMM d, yyyy")}</span>
                  {a.matched_keywords?.map((kw: string) => (
                    <span key={kw} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">{kw}</span>
                  ))}
                </div>
              </div>
              <span className={`sentiment-badge flex-shrink-0 ${a.sentiment === 'positive' ? 'sentiment-positive' : a.sentiment === 'negative' ? 'sentiment-negative' : 'sentiment-neutral'}`}>
                {a.sentiment}
              </span>
              <ExternalLink className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition mt-1" />
            </a>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="p-2 rounded-xl bg-bg-elevated text-text-secondary hover:bg-bg-subtle disabled:opacity-30 transition">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-text-muted">{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="p-2 rounded-xl bg-bg-elevated text-text-secondary hover:bg-bg-subtle disabled:opacity-30 transition">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
