import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Search, Loader2, Globe, Rss, FileText, Code, AlertTriangle } from "lucide-react";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import { format } from "date-fns";

const FLAG: Record<string, string> = {
  US: "🇺🇸", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", QA: "🇶🇦", SE: "🇸🇪", JP: "🇯🇵", AU: "🇦🇺",
};

const REGIONS = ["all", "wire", "press", "business", "nordics"];

const SOURCE_TYPE_META: Record<string, { icon: typeof Rss; label: string; color: string }> = {
  rss: { icon: Rss, label: "RSS", color: "bg-accent/15 text-accent" },
  atom: { icon: Rss, label: "Atom", color: "bg-accent/15 text-accent" },
  sitemap: { icon: FileText, label: "Sitemap", color: "bg-positive/15 text-positive" },
  news_sitemap: { icon: FileText, label: "News SM", color: "bg-positive/15 text-positive" },
  html: { icon: Code, label: "HTML", color: "bg-[hsl(30,90%,60%)]/15 text-[hsl(30,90%,60%)]" },
  api: { icon: Globe, label: "API", color: "bg-text-muted/15 text-text-muted" },
};

interface DiscoveryResult {
  source_type: string;
  feed_url: string;
  domain: string;
  preview_articles: { title: string; url: string; date?: string }[];
}

export default function Sources() {
  const queryClient = useQueryClient();
  const [region, setRegion] = useState("all");
  const [inputUrl, setInputUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [newRegion, setNewRegion] = useState("press");
  const [addError, setAddError] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[] | null>(null);
  const [selectedResult, setSelectedResult] = useState<DiscoveryResult | null>(null);

  const { data: sources, isLoading, error } = useQuery({
    queryKey: ["sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sources").select("*").order("region").order("name");
      if (error) throw error;
      return data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("sources").update({ active: !active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] }),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      setAddError("");
      const result = selectedResult;
      if (!result) { setAddError("Please discover a source first"); return; }
      if (!newName.trim()) { setAddError("Name required"); return; }
      const { error } = await supabase.from("sources").insert({
        name: newName.trim(),
        rss_url: result.feed_url,
        region: newRegion,
        source_type: result.source_type,
        domain: result.domain,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      setNewName("");
      setInputUrl("");
      setDiscoveryResults(null);
      setSelectedResult(null);
    },
    onError: (e: any) => setAddError(e.message || "Failed to add"),
  });

  const handleDiscover = async () => {
    if (!inputUrl.trim()) { setAddError("Enter a URL or domain"); return; }
    setAddError("");
    setDiscovering(true);
    setDiscoveryResults(null);
    setSelectedResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("source-discover", {
        body: { input: inputUrl.trim() },
      });
      if (error) throw error;
      const results = data.results as DiscoveryResult[];
      setDiscoveryResults(results);
      if (results.length > 0) {
        setSelectedResult(results[0]);
        // Auto-fill name from domain
        if (!newName.trim()) {
          const domain = results[0].domain.replace(/^www\./, "");
          setNewName(domain.charAt(0).toUpperCase() + domain.slice(1).split(".")[0]);
        }
      }
    } catch (e: any) {
      setAddError(e.message || "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  const filtered = (sources ?? []).filter(s => region === "all" || s.region === region);
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, s) => {
    (acc[s.region] ??= []).push(s);
    return acc;
  }, {});

  if (error) return <ErrorBanner message="Failed to load sources." />;

  const getHealthColor = (status: string, failures: number) => {
    if (status === "healthy") return "bg-positive";
    if (status === "failing" || failures >= 4) return "bg-negative";
    if (status === "degraded" || failures >= 1) return "bg-[hsl(30,90%,60%)]";
    return "bg-neutral-sentiment";
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <h1 className="text-xl font-light tracking-tight text-foreground">Sources Manager</h1>

      {/* Add source */}
      <div className="monitor-card space-y-3">
        <p className="section-label">Add Source — URL, Feed, or Domain</p>
        <div className="flex gap-3 flex-wrap">
          <input
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            placeholder="Enter RSS URL, sitemap URL, or domain (e.g. bbc.com)"
            onKeyDown={e => e.key === "Enter" && handleDiscover()}
            className="flex-[3] min-w-[240px] px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
          />
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="px-4 py-2.5 rounded-xl bg-bg-subtle text-foreground text-sm font-medium hover:opacity-90 transition flex items-center gap-2"
          >
            {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Detect
          </button>
        </div>

        {/* Discovery results */}
        {discoveryResults && discoveryResults.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex gap-2 flex-wrap">
              {discoveryResults.map((r, i) => {
                const meta = SOURCE_TYPE_META[r.source_type] || SOURCE_TYPE_META.rss;
                const Icon = meta.icon;
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedResult(r)}
                    className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition ${
                      selectedResult === r ? "bg-accent/20 text-accent ring-1 ring-accent/30" : "bg-bg-subtle text-text-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {meta.label}
                  </button>
                );
              })}
            </div>

            {selectedResult && selectedResult.preview_articles.length > 0 && (
              <div className="bg-bg-elevated rounded-xl p-3 space-y-1.5 max-h-[180px] overflow-y-auto">
                <p className="text-xs text-text-muted mb-1">Preview ({selectedResult.preview_articles.length} articles)</p>
                {selectedResult.preview_articles.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-text-muted shrink-0">{a.date ? format(new Date(a.date), "MMM d") : "—"}</span>
                    <span className="text-foreground truncate">{a.title}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 flex-wrap items-end">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Source name"
                className="flex-1 min-w-[140px] px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
              />
              <select
                value={newRegion}
                onChange={e => setNewRegion(e.target.value)}
                className="px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {REGIONS.filter(r => r !== "all").map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button
                onClick={() => addMutation.mutate()}
                className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Source
              </button>
            </div>
          </div>
        )}

        {addError && <p className="text-xs text-negative">{addError}</p>}
      </div>

      {/* Region filter */}
      <div className="segment-control max-w-md">
        {REGIONS.map(r => (
          <button key={r} className={`segment-btn ${region === r ? 'active' : ''}`} onClick={() => setRegion(r)}>
            {r === "all" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
      </div>

      {/* Sources list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="monitor-card h-14 animate-pulse" />)}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <EmptyState message="No sources found" />
      ) : (
        Object.entries(grouped).map(([reg, list]) => (
          <div key={reg}>
            <p className="section-label mb-2">{reg.toUpperCase()}</p>
            <div className="space-y-1.5">
              {list.map(s => {
                const sourceType = (s as any).source_type || "rss";
                const failures = (s as any).consecutive_failures || 0;
                const meta = SOURCE_TYPE_META[sourceType] || SOURCE_TYPE_META.rss;
                const Icon = meta.icon;
                return (
                  <div key={s.id} className="monitor-card flex items-center gap-3 py-3">
                    <span className="text-lg">{FLAG[s.country_code ?? ""] ?? "🌐"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-foreground font-light">{s.name}</p>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${meta.color}`}>
                          <Icon className="w-2.5 h-2.5 inline mr-0.5" />
                          {meta.label}
                        </span>
                        {failures >= 4 && (
                          <span className="text-negative text-[10px] flex items-center gap-0.5">
                            <AlertTriangle className="w-3 h-3" /> Failing
                          </span>
                        )}
                        {failures >= 1 && failures < 4 && (
                          <span className="text-[hsl(30,90%,60%)] text-[10px]">⚠ {failures} fail{failures > 1 ? "s" : ""}</span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted truncate">{s.rss_url}</p>
                    </div>
                    <span className="text-xs text-text-muted whitespace-nowrap">
                      {s.last_fetched_at ? format(new Date(s.last_fetched_at), "MMM d HH:mm") : "Never"}
                    </span>
                    <div className={`w-2 h-2 rounded-full ${getHealthColor(s.health_status, failures)}`} />
                    <button
                      onClick={() => toggleMutation.mutate({ id: s.id, active: s.active })}
                      className={`px-2.5 py-1 rounded-lg text-xs transition ${s.active ? 'bg-positive/15 text-positive' : 'bg-bg-subtle text-text-muted'}`}
                    >
                      {s.active ? "On" : "Off"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
