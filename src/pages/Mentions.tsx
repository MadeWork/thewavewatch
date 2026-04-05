import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subMonths } from "date-fns";
import { Search, Download, ExternalLink, ChevronLeft, ChevronRight, X, Filter, Sparkles, Bookmark, List, Table, Tag, StickyNote, CheckSquare, Calendar, Loader2, Shield, Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import ArticleDetailDrawer from "@/components/ArticleDetailDrawer";
import SearchBuilder, { SearchQuery } from "@/components/SearchBuilder";
import { useBookmarks } from "@/hooks/useArticleActions";
import { useArticles } from "@/hooks/useArticles";
import { isPaywalled } from "@/lib/paywallSources";

const PAGE_SIZE = 20;

function getEraBadge(article: any): { label: string; className: string } | null {
  const pubDate = article.published_at ? new Date(article.published_at) : null
  if (!pubDate) return null
  const ageDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays > 30) return { label: `${Math.round(ageDays)}d ago`, className: 'text-muted-foreground bg-muted text-xs px-2 py-0.5 rounded-full' }
  if (ageDays > 7) return { label: `${Math.round(ageDays)}d ago`, className: 'text-blue-400 bg-blue-500/10 text-xs px-2 py-0.5 rounded-full' }
  return null
}

export default function Mentions() {
  const [page, setPage] = useState(0);
  const [viewMode, setViewMode] = useState<"list" | "table">("list");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState<SearchQuery | null>(null);
  const [quickSearch, setQuickSearch] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [dateField, setDateField] = useState<"published_at" | "fetched_at">("published_at");
  const [relevanceFilter, setRelevanceFilter] = useState<"medium" | "high" | "all">("medium");
  const [majorOnly, setMajorOnly] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [eraFilter, setEraFilter] = useState<string>('All');

  const { bookmarks, toggleBookmark, isBookmarked } = useBookmarks();

  const { articles, isLoading, newCount, setNewCount, connected } = useArticles();

  // Track ingestion status in real-time
  useEffect(() => {
    const channel = supabase
      .channel('ingestion-status')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingestion_runs' },
        (payload) => {
          const run = payload.new as any
          if (run.status === 'running') {
            setIsFetching(true)
          }
          if (run.status === 'success' || run.status === 'failed') {
            supabase
              .from('ingestion_runs')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'running')
              .then(({ count }) => {
                if (!count || count === 0) setIsFetching(false)
              })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const error = null; // errors handled inside useArticles

  const { data: keywordTexts } = useQuery({
    queryKey: ["keywords-texts"],
    queryFn: async () => {
      const { data } = await supabase.from("keywords").select("text").eq("active", true);
      return data?.map(k => k.text) ?? [];
    },
  });

  const allSources = useMemo(() => {
    const s = new Set<string>();
    (articles ?? []).forEach(a => { const n = a.source_name || (a.sources as any)?.name; if (n) s.add(n); });
    return Array.from(s).sort();
  }, [articles]);

  const allCountries = useMemo(() => {
    const c = new Set<string>();
    (articles ?? []).forEach(a => { const cc = a.country || (a.sources as any)?.country_code; if (cc) c.add(cc); });
    return Array.from(c).sort();
  }, [articles]);

  const filtered = useMemo(() => {
    let result = articles ?? [];

    // Era filter
    if (eraFilter === 'Live (7d)') result = result.filter(a => a.published_at && new Date(a.published_at) >= new Date(Date.now() - 7*24*60*60*1000))
    else if (eraFilter === 'Recent (30d)') result = result.filter(a => a.published_at && new Date(a.published_at) >= new Date(Date.now() - 30*24*60*60*1000) && new Date(a.published_at) < new Date(Date.now() - 7*24*60*60*1000))
    else if (eraFilter === 'Archive (30d+)') result = result.filter(a => a.published_at && new Date(a.published_at) < new Date(Date.now() - 30*24*60*60*1000))

    // Exclude duplicates
    result = result.filter(a => !(a as any).is_duplicate);

    // Relevance filter
    if (relevanceFilter === "high") {
      result = result.filter(a => (a as any).relevance_label === "high" || !(a as any).is_enriched);
    } else if (relevanceFilter === "medium") {
      result = result.filter(a => ["high", "medium"].includes((a as any).relevance_label) || !(a as any).is_enriched);
    }
    // "all" still excludes noise and duplicates
    result = result.filter(a => (a as any).relevance_label !== "noise" || !(a as any).is_enriched);

    // Major outlets filter
    if (majorOnly) {
      result = result.filter(a => (a as any).is_major_outlet === true);
    }

    // Quick search
    if (quickSearch) {
      const q = quickSearch.toLowerCase();
      result = result.filter(a => a.title.toLowerCase().includes(q) || a.snippet?.toLowerCase().includes(q));
    }

    // Bookmarks filter
    if (showBookmarksOnly) {
      result = result.filter(a => bookmarks.includes(a.id));
    }

    // Advanced search
    if (searchQuery) {
      const sq = searchQuery;
      if (sq.terms.length > 0) {
        result = result.filter(a => {
          const text = `${a.title} ${a.snippet || ""} ${(a.matched_keywords || []).join(" ")}`.toLowerCase();
          return sq.terms.every(t => {
            const val = t.exact ? `"${t.value.toLowerCase()}"` : t.value.toLowerCase();
            const matches = t.exact ? text.includes(t.value.toLowerCase()) : text.includes(val);
            return t.operator === "NOT" ? !matches : matches;
          });
        });
      }
      if (sq.sources.length > 0) result = result.filter(a => sq.sources.includes((a.sources as any)?.name || a.source_name || ""));
      if (sq.countries.length > 0) result = result.filter(a => sq.countries.includes((a.sources as any)?.country_code || ""));
      if (sq.sentiments.length > 0) result = result.filter(a => sq.sentiments.includes(a.sentiment || ""));
      if (sq.dateRange !== "all") {
        const now = new Date();
        let cutoff: Date;
        switch (sq.dateRange) {
          case "1d": cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
          case "7d": cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
          case "30d": cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
          case "3m": cutoff = subMonths(now, 3); break;
          case "6m": cutoff = subMonths(now, 6); break;
          case "1y": cutoff = subMonths(now, 12); break;
          default: cutoff = new Date(0);
        }
        result = result.filter(a => new Date(a.published_at) >= cutoff);
      }
    }

    // Sort: enriched first, then unenriched at bottom; within each group by date
    result = [...result].sort((a, b) => {
      const enrichedA = (a as any).is_enriched ? 1 : 0;
      const enrichedB = (b as any).is_enriched ? 1 : 0;
      if (enrichedA !== enrichedB) return enrichedB - enrichedA;
      const dateA = a.published_at || a.fetched_at;
      const dateB = b.published_at || b.fetched_at;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
    return result;
  }, [articles, quickSearch, searchQuery, showBookmarksOnly, bookmarks, dateField, relevanceFilter, majorOnly, eraFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === paged.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(paged.map(a => a.id)));
  };

  const exportCSV = () => {
    const toExport = selectedIds.size > 0 ? filtered.filter(a => selectedIds.has(a.id)) : filtered;
    const rows = [["Title", "Source", "Domain", "Country", "Language", "Date", "Sentiment", "Keywords", "URL"]];
    toExport.forEach(a => {
      const s = a.sources as any;
      rows.push([a.title, s?.name || a.source_name || "", a.source_domain || "", s?.country_code || "", a.language || "", format(new Date(a.published_at), "yyyy-MM-dd"), a.sentiment || "", (a.matched_keywords || []).join("; "), a.url]);
    });
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "mentions-export.csv"; link.click();
    URL.revokeObjectURL(url);
  };

  const highlightMatch = (text: string) => {
    if (!searchQuery?.terms.length) return text;
    let highlighted = text;
    searchQuery.terms.forEach(t => {
      if (t.operator === "NOT") return;
      const regex = new RegExp(`(${t.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      highlighted = highlighted.replace(regex, "⟨⟨$1⟩⟩");
    });
    return highlighted;
  };

  const renderHighlighted = (text: string) => {
    const parts = highlightMatch(text).split(/⟨⟨|⟩⟩/);
    return parts.map((part, i) => i % 2 === 1 ? <mark key={i} className="bg-primary/30 text-foreground rounded px-0.5">{part}</mark> : part);
  };

  const COUNTRY_NAMES: Record<string, string> = {
    US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France", SE: "Sweden",
    PT: "Portugal", QA: "Qatar", JP: "Japan", AU: "Australia", BR: "Brazil", IN: "India",
    CN: "China", ZA: "South Africa", NG: "Nigeria", EG: "Egypt", KR: "South Korea",
    CA: "Canada", MX: "Mexico", AR: "Argentina", RU: "Russia", IT: "Italy",
    NO: "Norway", DK: "Denmark", FI: "Finland", ES: "Spain", NL: "Netherlands",
    BE: "Belgium", CH: "Switzerland", AT: "Austria", IE: "Ireland", SG: "Singapore",
    NZ: "New Zealand", PL: "Poland", CZ: "Czech Republic", GR: "Greece",
  };

  if (error) return <ErrorBanner message="Failed to load mentions." />;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-light tracking-tight text-foreground">Mentions</h1>
          <span className="text-xs text-text-muted">({filtered.length})</span>
          <span className={`inline-flex items-center gap-1.5 text-[10px] ${connected ? 'text-positive' : 'text-text-muted'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-positive animate-pulse' : 'bg-text-muted'}`} />
            {connected ? 'Live' : 'Connecting...'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="segment-control" style={{ maxWidth: 100 }}>
            <button className={`segment-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")} style={{ padding: "4px 8px" }}>
              <List className="w-3.5 h-3.5 mx-auto" />
            </button>
            <button className={`segment-btn ${viewMode === "table" ? "active" : ""}`} onClick={() => setViewMode("table")} style={{ padding: "4px 8px" }}>
              <Table className="w-3.5 h-3.5 mx-auto" />
            </button>
          </div>
          <button onClick={() => setShowBookmarksOnly(!showBookmarksOnly)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition ${showBookmarksOnly ? "bg-primary/20 text-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-subtle"}`}>
            <Bookmark className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Saved</span>
          </button>
          <button onClick={() => { setMajorOnly(!majorOnly); setPage(0); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition ${majorOnly ? "bg-primary/20 text-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-subtle"}`}>
            <Shield className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Major Only</span>
          </button>
          {/* Date field toggle */}
          <div className="segment-control" style={{ maxWidth: 180 }}>
            <button className={`segment-btn ${dateField === "published_at" ? "active" : ""}`} onClick={() => { setDateField("published_at"); setPage(0); }} style={{ padding: "4px 8px", fontSize: 10 }}>
              <Calendar className="w-3 h-3 inline mr-1" />Published
            </button>
            <button className={`segment-btn ${dateField === "fetched_at" ? "active" : ""}`} onClick={() => { setDateField("fetched_at"); setPage(0); }} style={{ padding: "4px 8px", fontSize: 10 }}>
              <Calendar className="w-3 h-3 inline mr-1" />Imported
            </button>
          </div>
          <button onClick={() => setShowSearch(!showSearch)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-bg-elevated text-text-secondary text-xs hover:bg-bg-subtle transition">
            <Filter className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Advanced</span>
          </button>
          <button onClick={exportCSV} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-bg-elevated text-text-secondary text-xs hover:bg-bg-subtle transition">
            <Download className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Export{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
          </button>
        </div>
      </div>

      {/* Live fetch banner */}
      {isFetching && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse-dot" />
          <span className="text-xs text-primary font-medium">Fetching latest articles — new mentions will appear automatically</span>
        </div>
      )}

      {/* New articles floating pill */}
      {newCount > 0 && !isLoading && (
        <button
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' })
            setNewCount(0)
          }}
          className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-2 rounded-full border border-primary/30 bg-card text-primary text-[13px] font-medium cursor-pointer shadow-lg hover:bg-primary/10 transition"
        >
          ↑ {newCount} new {newCount === 1 ? 'article' : 'articles'} arrived
        </button>
      )}

      {/* Quick search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input value={quickSearch} onChange={e => { setQuickSearch(e.target.value); setPage(0); }}
          placeholder="Quick search…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
      </div>

      {/* Advanced search builder */}
      {showSearch && (
        <SearchBuilder
          onSearch={(q) => { setSearchQuery(q); setPage(0); }}
          keywords={keywordTexts ?? []}
          sources={allSources}
          countries={allCountries}
          initialQuery={searchQuery ?? undefined}
        />
      )}

      {/* Relevance filter bar */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-text-muted mr-1">Quality:</span>
        {([["high", "Top stories"], ["medium", "All relevant"], ["all", "Everything"]] as const).map(([val, label]) => (
          <button key={val} onClick={() => { setRelevanceFilter(val as any); setPage(0); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] transition ${relevanceFilter === val ? "bg-primary text-primary-foreground" : "bg-bg-elevated text-text-secondary hover:bg-bg-subtle"}`}>
            {label}
          </button>
        ))}
      </div>
      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20">
          <span className="text-xs text-primary font-medium">{selectedIds.size} selected</span>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-text-muted hover:text-foreground transition">Clear</button>
          <button onClick={exportCSV} className="text-xs text-primary hover:text-foreground transition flex items-center gap-1"><Download className="w-3 h-3" /> Export selected</button>
        </div>
      )}

      {/* Articles */}
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="monitor-card animate-pulse h-16" />)}</div>
      ) : paged.length === 0 ? (
        <EmptyState message="No articles match your search" />
      ) : viewMode === "table" ? (
        /* Table view */
        <div className="monitor-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-bg-subtle">
                <th className="py-2 pr-2"><input type="checkbox" checked={selectedIds.size === paged.length} onChange={selectAll} className="rounded" /></th>
                <th className="py-2 pr-2 section-label">Title</th>
                <th className="py-2 pr-2 section-label">Source</th>
                <th className="py-2 pr-2 section-label">Country</th>
                <th className="py-2 pr-2 section-label">Date</th>
                <th className="py-2 pr-2 section-label">Sentiment</th>
                <th className="py-2 pr-2 section-label">Keywords</th>
                <th className="py-2 section-label"></th>
              </tr>
            </thead>
            <tbody>
              {paged.map(a => {
                const src = a.sources as any;
                const displayName = src?.name || a.source_name || a.source_domain || "Unknown";
                const showPaywall = isPaywalled(a.source_url || a.source_domain);
                return (
                  <tr key={a.id} className="border-b border-bg-subtle/50 hover:bg-bg-elevated/50 transition cursor-pointer" onClick={() => setSelectedArticle(a)}>
                    <td className="py-2 pr-2" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} className="rounded" />
                    </td>
                    <td className="py-2 pr-2 text-foreground font-light max-w-[300px] truncate">{renderHighlighted(a.title)}</td>
                    <td className="py-2 pr-2 text-text-secondary">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{displayName}</span>
                        {showPaywall && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                            <Lock className="h-2.5 w-2.5" /> Subscription
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-text-muted">{src?.country_code || ""}</td>
                    <td className="py-2 pr-2 text-text-muted whitespace-nowrap">{a.published_at ? format(new Date(a.published_at), "MMM d, yyyy") : <span className="italic opacity-60">no date</span>}</td>
                    <td className="py-2 pr-2">
                      <span className={`sentiment-badge text-[10px] ${a.sentiment === "positive" ? "sentiment-positive" : a.sentiment === "negative" ? "sentiment-negative" : "sentiment-neutral"}`}>{a.sentiment}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex gap-1 flex-wrap">
                        {a.matched_keywords?.slice(0, 2).map((kw: string) => (
                          <span key={kw} className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px]">{kw}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => toggleBookmark(a.id)} className="p-1 rounded hover:bg-bg-subtle transition">
                          <Bookmark className={`w-3 h-3 ${isBookmarked(a.id) ? "fill-primary text-primary" : "text-text-muted"}`} />
                        </button>
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-bg-subtle transition">
                          <ExternalLink className="w-3 h-3 text-text-muted" />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* List view */
        <div className="space-y-2">
          {paged.map(a => {
            const src = a.sources as any;
            const displayName = src?.name || a.source_name || a.source_domain || "Unknown";
            const showPaywall = isPaywalled(a.source_url || a.source_domain);
            return (
              <div key={a.id} className="monitor-card flex items-start gap-3 hover:bg-bg-elevated/80 transition group cursor-pointer" onClick={() => setSelectedArticle(a)}>
                <div className="flex items-center gap-2 pt-1" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} className="rounded" />
                  <button onClick={() => toggleBookmark(a.id)} className="p-0.5 rounded hover:bg-bg-subtle transition">
                    <Bookmark className={`w-3.5 h-3.5 ${isBookmarked(a.id) ? "fill-primary text-primary" : "text-text-muted"}`} />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-light group-hover:text-primary transition">{renderHighlighted(a.title)}</p>
                  {a.snippet && <p className="text-xs text-text-muted mt-1 line-clamp-2">{renderHighlighted(a.snippet || "")}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {src?.country_code && <span className="text-xs">{src.country_code}</span>}
                    <span className="text-xs text-text-secondary">{displayName}</span>
                    {showPaywall && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                        <Lock className="h-2.5 w-2.5" /> Subscription
                      </span>
                    )}
                    {a.source_domain && <span className="text-[10px] text-text-muted">({a.source_domain})</span>}
                    <span className="text-xs text-text-muted">·</span>
                    {a.published_at ? (
                      <span className="text-xs text-text-muted">{format(new Date(a.published_at), "MMM d, yyyy HH:mm")}</span>
                    ) : (
                      <span className="text-xs text-text-muted italic opacity-60">imported {format(new Date(a.fetched_at), "MMM d")}</span>
                    )}
                    {a.published_at && dateField === "fetched_at" && (
                      <span className="text-[9px] text-text-muted opacity-60">pub: {format(new Date(a.published_at), "MMM d")}</span>
                    )}
                    {a.language && <span className="px-1 py-0.5 rounded bg-bg-subtle text-text-muted text-[10px]">{a.language}</span>}
                    {src?.region && <span className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted text-[10px]">{src.region}</span>}
                    {/* Relevance badge */}
                    {(a as any).is_enriched ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              (a as any).relevance_label === "high" ? "bg-positive/15 text-positive" :
                              (a as any).relevance_label === "medium" ? "bg-amber-500/15 text-amber-400" :
                              "bg-bg-subtle text-text-muted"
                            }`}>
                              {(a as any).relevance_label === "high" ? "● High" : (a as any).relevance_label === "medium" ? "● Medium" : "● Low"}
                            </span>
                          </TooltipTrigger>
                          {(a as any).relevance_reason && (
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              {(a as any).relevance_reason}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted text-[10px] flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> Scoring…
                      </span>
                    )}
                    {/* Key themes */}
                    {(a as any).key_themes?.slice(0, 3).map((theme: string) => (
                      <span key={theme} className="px-1.5 py-0.5 rounded-full bg-secondary/50 text-secondary-foreground text-[9px]">{theme}</span>
                    ))}
                    {(a as any).story_cluster_id && <span className="px-1.5 py-0.5 rounded bg-accent/30 text-accent-foreground text-[10px]">📰 Cluster</span>}
                    {(a as any).discovery_method && <span className="px-1 py-0.5 rounded bg-bg-subtle text-text-muted text-[9px]">{(a as any).discovery_method}</span>}
                    {a.matched_keywords?.map((kw: string) => (
                      <span key={kw} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">{kw}</span>
                    ))}
                  </div>
                </div>
                <span className={`sentiment-badge flex-shrink-0 ${a.sentiment === "positive" ? "sentiment-positive" : a.sentiment === "negative" ? "sentiment-negative" : "sentiment-neutral"}`}>
                  {a.sentiment}
                </span>
                <Sparkles className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition mt-1" />
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
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

      {/* Article Detail Drawer */}
      {selectedArticle && <ArticleDetailDrawer article={selectedArticle} onClose={() => setSelectedArticle(null)} />}
    </div>
  );
}
