import { useState } from "react";
import { Search, Plus, X, Save, FolderOpen, Trash2 } from "lucide-react";
import { useSavedSearches } from "@/hooks/useArticleActions";

export interface SearchQuery {
  terms: SearchTerm[];
  sources: string[];
  countries: string[];
  languages: string[];
  sentiments: string[];
  dateRange: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchTerm {
  id: string;
  value: string;
  operator: "AND" | "OR" | "NOT";
  exact: boolean;
}

const DEFAULT_QUERY: SearchQuery = {
  terms: [],
  sources: [],
  countries: [],
  languages: [],
  sentiments: [],
  dateRange: "all",
};

interface Props {
  onSearch: (query: SearchQuery) => void;
  keywords: string[];
  sources: string[];
  countries: string[];
  initialQuery?: SearchQuery;
}

export default function SearchBuilder({ onSearch, keywords, sources, countries, initialQuery }: Props) {
  const [query, setQuery] = useState<SearchQuery>(initialQuery || DEFAULT_QUERY);
  const [termInput, setTermInput] = useState("");
  const [termOp, setTermOp] = useState<"AND" | "OR" | "NOT">("AND");
  const [termExact, setTermExact] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const { searches, saveSearch, deleteSearch } = useSavedSearches();

  const addTerm = () => {
    if (!termInput.trim()) return;
    setQuery(q => ({
      ...q,
      terms: [...q.terms, { id: crypto.randomUUID(), value: termInput.trim(), operator: termOp, exact: termExact }],
    }));
    setTermInput("");
  };

  const removeTerm = (id: string) => {
    setQuery(q => ({ ...q, terms: q.terms.filter(t => t.id !== id) }));
  };

  const toggleArrayFilter = (key: keyof Pick<SearchQuery, "sources" | "countries" | "languages" | "sentiments">, val: string) => {
    setQuery(q => ({
      ...q,
      [key]: q[key].includes(val) ? q[key].filter(v => v !== val) : [...q[key], val],
    }));
  };

  const handleSave = () => {
    if (!saveName.trim()) return;
    saveSearch({ name: saveName.trim(), query });
    setSaveName("");
    setShowSave(false);
  };

  const loadSearch = (search: any) => {
    const loaded = search.query as SearchQuery;
    setQuery(loaded);
    onSearch(loaded);
    setShowSaved(false);
  };

  const presets = [
    { label: "Negative mentions", fn: () => setQuery(q => ({ ...q, sentiments: ["negative"] })) },
    { label: "Last 24h", fn: () => setQuery(q => ({ ...q, dateRange: "1d" })) },
    { label: "Last 7 days", fn: () => setQuery(q => ({ ...q, dateRange: "7d" })) },
  ];

  const activeCount = query.terms.length + query.sources.length + query.countries.length + query.sentiments.length + (query.dateRange !== "all" ? 1 : 0);

  return (
    <div className="monitor-card space-y-4">
      <div className="flex items-center justify-between">
        <p className="section-label flex items-center gap-2"><Search className="w-3.5 h-3.5" /> Advanced Search</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSaved(!showSaved)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-bg-elevated text-text-secondary text-[11px] hover:bg-bg-subtle transition">
            <FolderOpen className="w-3 h-3" /> Saved ({searches.length})
          </button>
          <button onClick={() => setShowSave(!showSave)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] hover:bg-primary/20 transition">
            <Save className="w-3 h-3" /> Save
          </button>
        </div>
      </div>

      {/* Save dialog */}
      {showSave && (
        <div className="flex items-center gap-2">
          <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Search name…"
            className="flex-1 px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <button onClick={handleSave} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs">Save</button>
          <button onClick={() => setShowSave(false)} className="p-2 rounded-xl bg-bg-subtle text-text-muted"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Saved searches list */}
      {showSaved && searches.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {searches.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-bg-elevated hover:bg-bg-subtle transition cursor-pointer" onClick={() => loadSearch(s)}>
              <span className="text-xs text-foreground">{s.name}</span>
              <button onClick={e => { e.stopPropagation(); deleteSearch(s.id); }} className="p-1 rounded hover:bg-negative/10 transition">
                <Trash2 className="w-3 h-3 text-text-muted hover:text-negative" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Quick presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-text-muted uppercase tracking-wider">Quick:</span>
        {presets.map(p => (
          <button key={p.label} onClick={p.fn} className="px-2.5 py-1 rounded-lg bg-bg-elevated text-text-secondary text-[11px] hover:bg-bg-subtle transition">{p.label}</button>
        ))}
        {keywords.slice(0, 5).map(kw => (
          <button key={kw} onClick={() => setQuery(q => ({
            ...q,
            terms: [...q.terms, { id: crypto.randomUUID(), value: kw, operator: "OR", exact: false }],
          }))} className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[11px] hover:bg-primary/20 transition">{kw}</button>
        ))}
      </div>

      {/* Term builder */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="segment-control" style={{ maxWidth: 160 }}>
          {(["AND", "OR", "NOT"] as const).map(op => (
            <button key={op} className={`segment-btn ${termOp === op ? "active" : ""}`} onClick={() => setTermOp(op)} style={{ padding: "4px 8px", fontSize: 11 }}>{op}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
          <input type="checkbox" checked={termExact} onChange={e => setTermExact(e.target.checked)} className="rounded" />
          Exact
        </label>
        <input value={termInput} onChange={e => setTermInput(e.target.value)} placeholder="Add search term…"
          onKeyDown={e => e.key === "Enter" && addTerm()}
          className="flex-1 min-w-[150px] px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
        <button onClick={addTerm} className="p-2 rounded-xl bg-primary text-primary-foreground"><Plus className="w-3.5 h-3.5" /></button>
      </div>

      {/* Active terms */}
      {query.terms.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {query.terms.map((t, i) => (
            <span key={t.id} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-primary/10 text-primary">
              {i > 0 && <span className="text-text-muted font-medium mr-0.5">{t.operator}</span>}
              {t.exact ? `"${t.value}"` : t.value}
              <X className="w-3 h-3 cursor-pointer hover:text-negative" onClick={() => removeTerm(t.id)} />
            </span>
          ))}
        </div>
      )}

      {/* Filters grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Sources */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Sources</p>
          <div className="max-h-28 overflow-y-auto space-y-1">
            {sources.slice(0, 15).map(s => (
              <label key={s} className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer hover:text-foreground">
                <input type="checkbox" checked={query.sources.includes(s)} onChange={() => toggleArrayFilter("sources", s)} className="rounded" />
                <span className="truncate">{s}</span>
              </label>
            ))}
          </div>
        </div>
        {/* Countries */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Countries</p>
          <div className="max-h-28 overflow-y-auto space-y-1">
            {countries.map(c => (
              <label key={c} className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer hover:text-foreground">
                <input type="checkbox" checked={query.countries.includes(c)} onChange={() => toggleArrayFilter("countries", c)} className="rounded" />
                {c}
              </label>
            ))}
          </div>
        </div>
        {/* Sentiment */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Sentiment</p>
          {["positive", "neutral", "negative"].map(s => (
            <label key={s} className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer hover:text-foreground mb-1">
              <input type="checkbox" checked={query.sentiments.includes(s)} onChange={() => toggleArrayFilter("sentiments", s)} className="rounded" />
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </label>
          ))}
        </div>
        {/* Date */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Date Range</p>
          <select value={query.dateRange} onChange={e => setQuery(q => ({ ...q, dateRange: e.target.value }))}
            className="w-full px-2 py-1.5 rounded-lg bg-bg-elevated border border-bg-subtle text-foreground text-xs">
            {[{ l: "All time", v: "all" }, { l: "Last 24h", v: "1d" }, { l: "Last 7 days", v: "7d" }, { l: "Last 30 days", v: "30d" }, { l: "Last 3 months", v: "3m" }, { l: "Last 6 months", v: "6m" }, { l: "Last year", v: "1y" }].map(d => (
              <option key={d.v} value={d.v}>{d.l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Apply */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-muted">{activeCount} active filter{activeCount !== 1 ? "s" : ""}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => { setQuery(DEFAULT_QUERY); onSearch(DEFAULT_QUERY); }} className="px-3 py-2 rounded-xl bg-bg-elevated text-text-secondary text-xs hover:bg-bg-subtle transition">Clear All</button>
          <button onClick={() => onSearch(query)} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" /> Search
          </button>
        </div>
      </div>
    </div>
  );
}
