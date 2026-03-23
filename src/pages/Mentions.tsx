import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subMonths } from "date-fns";
import { Search, Download, ExternalLink, ChevronLeft, ChevronRight, X, Filter, Calendar } from "lucide-react";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

const PAGE_SIZE = 20;
const SENTIMENTS = ["all", "positive", "neutral", "negative"];
const DATE_RANGES = [
  { label: "All time", value: "all" },
  { label: "Last 24h", value: "1d" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 3 months", value: "3m" },
  { label: "Last 6 months", value: "6m" },
];

export default function Mentions() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("all");
  const [selectedCountry, setSelectedCountry] = useState("all");
  const [selectedKeyword, setSelectedKeyword] = useState("all");
  const [selectedSource, setSelectedSource] = useState("all");
  const [sentiment, setSentiment] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");
  const [showFilters, setShowFilters] = useState(true);

  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["mentions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("*, sources(name, region, country_code)")
        .order("published_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const { data: keywords } = useQuery({
    queryKey: ["keywords"],
    queryFn: async () => {
      const { data } = await supabase.from("keywords").select("text").eq("active", true);
      return data?.map(k => k.text) ?? [];
    },
  });

  // Derive unique filter options from data
  const filterOptions = useMemo(() => {
    const regions = new Set<string>();
    const countries = new Set<string>();
    const sources = new Set<string>();
    (articles ?? []).forEach(a => {
      const s = a.sources as any;
      if (s?.region) regions.add(s.region);
      if (s?.country_code) countries.add(s.country_code);
      if (s?.name) sources.add(s.name);
    });
    return {
      regions: ["all", ...Array.from(regions).sort()],
      countries: ["all", ...Array.from(countries).sort()],
      sources: ["all", ...Array.from(sources).sort()],
    };
  }, [articles]);

  const allKeywords = useMemo(() => {
    const kws = new Set<string>();
    (articles ?? []).forEach(a => a.matched_keywords?.forEach((k: string) => kws.add(k)));
    if (keywords) keywords.forEach(k => kws.add(k));
    return ["all", ...Array.from(kws).sort()];
  }, [articles, keywords]);

  const activeFilterCount = [selectedRegion, selectedCountry, selectedKeyword, selectedSource, sentiment, dateRange]
    .filter(v => v !== "all").length;

  const filtered = useMemo(() => {
    let result = articles ?? [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a => a.title.toLowerCase().includes(q) || a.snippet?.toLowerCase().includes(q));
    }
    if (dateRange !== "all") {
      const now = new Date();
      let cutoff: Date;
      switch (dateRange) {
        case "1d": cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
        case "7d": cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case "30d": cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
        case "3m": cutoff = subMonths(now, 3); break;
        case "6m": cutoff = subMonths(now, 6); break;
        default: cutoff = new Date(0);
      }
      result = result.filter(a => new Date(a.published_at) >= cutoff);
    }
    if (selectedRegion !== "all") result = result.filter(a => (a.sources as any)?.region === selectedRegion);
    if (selectedCountry !== "all") result = result.filter(a => (a.sources as any)?.country_code === selectedCountry);
    if (selectedSource !== "all") result = result.filter(a => (a.sources as any)?.name === selectedSource);
    if (selectedKeyword !== "all") result = result.filter(a => a.matched_keywords?.includes(selectedKeyword));
    if (sentiment !== "all") result = result.filter(a => a.sentiment === sentiment);
    if (sortBy === "oldest") result = [...result].reverse();
    return result;
  }, [articles, search, dateRange, selectedRegion, selectedCountry, selectedSource, selectedKeyword, sentiment, sortBy]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const clearFilters = () => {
    setSelectedRegion("all"); setSelectedCountry("all");
    setSelectedKeyword("all"); setSelectedSource("all");
    setSentiment("all"); setDateRange("all"); setSearch(""); setPage(0);
  };

  const exportCSV = () => {
    const rows = [["Title", "Source", "Region", "Country", "Date", "Sentiment", "Keywords", "URL"]];
    filtered.forEach(a => {
      const s = a.sources as any;
      rows.push([a.title, s?.name || "", s?.region || "", s?.country_code || "", format(new Date(a.published_at), "yyyy-MM-dd"), a.sentiment || "", (a.matched_keywords || []).join("; "), a.url]);
    });
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "mentions-export.csv"; link.click();
    URL.revokeObjectURL(url);
  };

  const COUNTRY_NAMES: Record<string, string> = {
    US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France", SE: "Sweden",
    PT: "Portugal", QA: "Qatar", JP: "Japan", AU: "Australia", BR: "Brazil", IN: "India",
    CN: "China", ZA: "South Africa", NG: "Nigeria", EG: "Egypt", KR: "South Korea",
    CA: "Canada", MX: "Mexico", AR: "Argentina", RU: "Russia", IT: "Italy",
    NO: "Norway", DK: "Denmark", FI: "Finland", ES: "Spain", NL: "Netherlands",
    BE: "Belgium", CH: "Switzerland", AT: "Austria", IE: "Ireland", SG: "Singapore",
  };

  if (error) return <ErrorBanner message="Failed to load mentions." />;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-light tracking-tight text-foreground">Mentions Feed</h1>
          <span className="text-xs text-text-muted">({filtered.length} articles)</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilters(f => !f)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-bg-elevated text-text-secondary text-xs hover:bg-bg-subtle transition">
            <Filter className="w-3.5 h-3.5" />
            Filters {activeFilterCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px]">{activeFilterCount}</span>}
          </button>
          <button onClick={exportCSV} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-bg-elevated text-text-secondary text-xs hover:bg-bg-subtle transition">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search articles…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="monitor-card space-y-3">
          <div className="flex items-center justify-between">
            <p className="section-label">Filters</p>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-text-muted hover:text-foreground transition">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Date Range */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Date Range</p>
              <select value={dateRange} onChange={e => { setDateRange(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                {DATE_RANGES.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            {/* Region */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Region</p>
              <select value={selectedRegion} onChange={e => { setSelectedRegion(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                {filterOptions.regions.map(r => (
                  <option key={r} value={r}>{r === "all" ? "All Regions" : r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>
            {/* Country */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Country</p>
              <select value={selectedCountry} onChange={e => { setSelectedCountry(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                {filterOptions.countries.map(c => (
                  <option key={c} value={c}>{c === "all" ? "All Countries" : COUNTRY_NAMES[c] || c}</option>
                ))}
              </select>
            </div>
            {/* Keyword */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Keyword</p>
              <select value={selectedKeyword} onChange={e => { setSelectedKeyword(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                {allKeywords.map(k => (
                  <option key={k} value={k}>{k === "all" ? "All Keywords" : k}</option>
                ))}
              </select>
            </div>
            {/* Source */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Source</p>
              <select value={selectedSource} onChange={e => { setSelectedSource(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                {filterOptions.sources.map(s => (
                  <option key={s} value={s}>{s === "all" ? "All Sources" : s}</option>
                ))}
              </select>
            </div>
            {/* Sentiment */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Sentiment</p>
              <select value={sentiment} onChange={e => { setSentiment(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                {SENTIMENTS.map(s => (
                  <option key={s} value={s}>{s === "all" ? "All Sentiments" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Sort */}
          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-wider text-text-muted">Sort:</p>
            <div className="segment-control">
              <button className={`segment-btn ${sortBy === 'newest' ? 'active' : ''}`} onClick={() => setSortBy("newest")}>Newest</button>
              <button className={`segment-btn ${sortBy === 'oldest' ? 'active' : ''}`} onClick={() => setSortBy("oldest")}>Oldest</button>
            </div>
          </div>
        </div>
      )}

      {/* Active filter pills */}
      {activeFilterCount > 0 && !showFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          {selectedRegion !== "all" && <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] flex items-center gap-1">{selectedRegion} <X className="w-3 h-3 cursor-pointer" onClick={() => setSelectedRegion("all")} /></span>}
          {selectedCountry !== "all" && <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] flex items-center gap-1">{COUNTRY_NAMES[selectedCountry] || selectedCountry} <X className="w-3 h-3 cursor-pointer" onClick={() => setSelectedCountry("all")} /></span>}
          {selectedKeyword !== "all" && <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] flex items-center gap-1">{selectedKeyword} <X className="w-3 h-3 cursor-pointer" onClick={() => setSelectedKeyword("all")} /></span>}
          {selectedSource !== "all" && <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] flex items-center gap-1">{selectedSource} <X className="w-3 h-3 cursor-pointer" onClick={() => setSelectedSource("all")} /></span>}
          {sentiment !== "all" && <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] flex items-center gap-1">{sentiment} <X className="w-3 h-3 cursor-pointer" onClick={() => setSentiment("all")} /></span>}
        </div>
      )}

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
          {paged.map(a => {
            const src = a.sources as any;
            return (
              <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
                className="monitor-card flex items-start gap-4 hover:bg-bg-elevated/80 transition group cursor-pointer">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-light group-hover:text-primary transition">{a.title}</p>
                  {a.snippet && <p className="text-xs text-text-muted mt-1 line-clamp-2">{a.snippet}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {src?.country_code && <span className="text-xs">{src.country_code}</span>}
                    <span className="text-xs text-text-secondary">{src?.name}</span>
                    <span className="text-xs text-text-muted">·</span>
                    <span className="text-xs text-text-muted">{format(new Date(a.published_at), "MMM d, yyyy")}</span>
                    {src?.region && <span className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted text-[10px]">{src.region}</span>}
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
            );
          })}
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
