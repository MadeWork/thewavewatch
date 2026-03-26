import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, Search, Loader2, Globe, Rss, FileText, Code, AlertTriangle,
  Upload, Download, Radar, CheckCircle, XCircle, Filter, Trash2
} from "lucide-react";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import { format } from "date-fns";

const FLAG: Record<string, string> = {
  US: "🇺🇸", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", QA: "🇶🇦", SE: "🇸🇪", JP: "🇯🇵", AU: "🇦🇺",
  CA: "🇨🇦", NL: "🇳🇱", IT: "🇮🇹", ES: "🇪🇸", NO: "🇳🇴", DK: "🇩🇰", FI: "🇫🇮", IE: "🇮🇪",
  HK: "🇭🇰", SG: "🇸🇬", IN: "🇮🇳", KR: "🇰🇷", TW: "🇹🇼", TH: "🇹🇭", PK: "🇵🇰",
  IL: "🇮🇱", SA: "🇸🇦", AE: "🇦🇪", ZA: "🇿🇦", KE: "🇰🇪", NG: "🇳🇬", BR: "🇧🇷",
  AR: "🇦🇷", MX: "🇲🇽",
};

const ALL_REGIONS = ["all", "wire", "press", "business", "nordics", "europe", "asia", "middle_east", "africa", "americas", "energy", "tech"];

const SOURCE_TYPE_META: Record<string, { icon: typeof Rss; label: string; color: string }> = {
  rss: { icon: Rss, label: "RSS", color: "bg-accent/15 text-accent" },
  atom: { icon: Rss, label: "Atom", color: "bg-accent/15 text-accent" },
  sitemap: { icon: FileText, label: "Sitemap", color: "bg-positive/15 text-positive" },
  news_sitemap: { icon: FileText, label: "News SM", color: "bg-positive/15 text-positive" },
  html: { icon: Code, label: "HTML", color: "bg-[hsl(30,90%,60%)]/15 text-[hsl(30,90%,60%)]" },
  api: { icon: Globe, label: "API", color: "bg-text-muted/15 text-text-muted" },
};

type Tab = "sources" | "domains" | "discover";

interface DiscoveryResult {
  source_type: string;
  feed_url: string;
  domain: string;
  preview_articles: { title: string; url: string; date?: string }[];
}

export default function Sources() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("sources");
  const [region, setRegion] = useState("all");
  const [countryFilter, setCountryFilter] = useState("");
  const [languageFilter, setLanguageFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Add source state
  const [inputUrl, setInputUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [newRegion, setNewRegion] = useState("press");
  const [addError, setAddError] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[] | null>(null);
  const [selectedResult, setSelectedResult] = useState<DiscoveryResult | null>(null);

  // Discovery state
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryStatus, setDiscoveryStatus] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ──
  const { data: sources, isLoading, error } = useQuery({
    queryKey: ["sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sources").select("*").order("region").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: approvedDomains, isLoading: domainsLoading } = useQuery({
    queryKey: ["approved_domains"],
    queryFn: async () => {
      const { data, error } = await supabase.from("approved_domains").select("*").order("priority", { ascending: false }).order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  // ── Mutations ──
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
      setNewName(""); setInputUrl(""); setDiscoveryResults(null); setSelectedResult(null);
    },
    onError: (e: any) => setAddError(e.message || "Failed to add"),
  });

  const approveDomainMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("approved_domains").update({ approval_status: status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approved_domains"] }),
  });

  const toggleDomainMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("approved_domains").update({ active: !active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approved_domains"] }),
  });

  const deleteSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] }),
  });

  // Promote domain to active source
  const promoteMutation = useMutation({
    mutationFn: async (domain: any) => {
      if (!domain.feed_url) { throw new Error("No feed URL available"); }
      const { error } = await supabase.from("sources").insert({
        name: domain.name,
        rss_url: domain.feed_url,
        region: domain.region,
        source_type: domain.source_type,
        domain: domain.domain,
        country_code: domain.country_code,
        language: domain.language,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] }),
  });

  // ── Handlers ──
  const handleDiscover = async () => {
    if (!inputUrl.trim()) { setAddError("Enter a URL or domain"); return; }
    setAddError(""); setDiscovering(true); setDiscoveryResults(null); setSelectedResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("source-discover", { body: { input: inputUrl.trim() } });
      if (error) throw error;
      const results = data.results as DiscoveryResult[];
      setDiscoveryResults(results);
      if (results.length > 0) {
        setSelectedResult(results[0]);
        if (!newName.trim()) {
          const domain = results[0].domain.replace(/^www\./, "");
          setNewName(domain.charAt(0).toUpperCase() + domain.slice(1).split(".")[0]);
        }
      }
    } catch (e: any) { setAddError(e.message || "Discovery failed"); }
    finally { setDiscovering(false); }
  };

  const handleGlobalDiscovery = async () => {
    setIsDiscovering(true);
    setDiscoveryStatus("Searching approved domains for keyword matches...");
    try {
      const { data, error } = await supabase.functions.invoke("discover-articles", {
        body: { max_domains: 50, region: region === "all" ? null : region },
      });
      if (error) throw error;

      const sitemapBatchSize = 5;
      const sitemapDeepScanLimit = 20;
      let sitemapCount = 0;
      let sitemapDomainsScanned = 0;

      const { count: approvedDomainCount, error: approvedDomainCountError } = await supabase
        .from("approved_domains")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .eq("approval_status", "approved");

      if (approvedDomainCountError) throw approvedDomainCountError;

      const sitemapBatches = Math.max(1, Math.ceil((approvedDomainCount ?? 0) / sitemapBatchSize));
      for (let batchIndex = 0; batchIndex < sitemapBatches; batchIndex += 1) {
        const sitemapResult = await supabase.functions.invoke("discover-sitemaps", {
          body: {
            max_domains: sitemapBatchSize,
            deep_scan_limit: sitemapDeepScanLimit,
            offset: batchIndex * sitemapBatchSize,
          },
        });

        if (sitemapResult.error) throw sitemapResult.error;

        sitemapCount += sitemapResult.data?.discovered ?? 0;
        sitemapDomainsScanned += sitemapResult.data?.domainsScanned ?? 0;
      }

      const { data: rssData, error: rssError } = await supabase.functions.invoke("fetch-rss", {
        body: { max_sources: 50 },
      });
      if (rssError) throw rssError;

      const summaryParts = [
        `Found ${data.discovered ?? 0} from discovery`,
        `${sitemapCount} from sitemaps across ${sitemapDomainsScanned} domains`,
      ];

      if ((rssData?.totalInserted ?? 0) > 0) {
        summaryParts.push(`${rssData.totalInserted} from RSS`);
      }

      setDiscoveryStatus(summaryParts.join(" · "));
      queryClient.invalidateQueries({ queryKey: ["articles"] });
      queryClient.invalidateQueries({ queryKey: ["mentions"] });
      queryClient.invalidateQueries({ queryKey: ["keywords"] });
    } catch (e: any) { setDiscoveryStatus(`Error: ${e.message}`); }
    finally { setIsDiscovering(false); }
  };

  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let items: any[];
      if (file.name.endsWith(".json")) {
        items = JSON.parse(text);
      } else {
        // CSV parsing
        const lines = text.split("\n").filter(l => l.trim());
        const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
        items = lines.slice(1).map(line => {
          const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
          const obj: any = {};
          headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
          return obj;
        });
      }

      const toInsert = items.map(item => ({
        name: item.name || item.domain,
        domain: item.domain,
        country_code: item.country_code || "US",
        region: item.region || "global",
        language: item.language || "en",
        source_type: item.source_type || "rss",
        feed_url: item.feed_url || null,
        approval_status: "pending",
        active: item.active !== false && item.active !== "false",
      }));

      const { error } = await supabase.from("approved_domains").upsert(toInsert, { onConflict: "domain", ignoreDuplicates: true });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["approved_domains"] });
      setDiscoveryStatus(`Imported ${toInsert.length} domains`);
    } catch (err: any) {
      setDiscoveryStatus(`Import error: ${err.message}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Filtering ──
  const filteredSources = (sources ?? []).filter(s => {
    if (region !== "all" && s.region !== region) return false;
    if (countryFilter && s.country_code !== countryFilter) return false;
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const groupedSources = filteredSources.reduce<Record<string, typeof filteredSources>>((acc, s) => {
    (acc[s.region] ??= []).push(s);
    return acc;
  }, {});

  const filteredDomains = (approvedDomains ?? []).filter(d => {
    if (region !== "all" && d.region !== region) return false;
    if (countryFilter && d.country_code !== countryFilter) return false;
    if (languageFilter && d.language !== languageFilter) return false;
    if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase()) && !d.domain.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const getHealthColor = (status: string, failures: number) => {
    if (status === "healthy") return "bg-positive";
    if (status === "failing" || failures >= 4) return "bg-negative";
    if (status === "degraded" || failures >= 1) return "bg-[hsl(30,90%,60%)]";
    return "bg-neutral-sentiment";
  };

  const countryValues = tab === "sources"
    ? (sources?.map(source => source.country_code) ?? [])
    : (approvedDomains?.map(domain => domain.country_code) ?? []);
  const uniqueCountries = [...new Set(countryValues.filter((country): country is string => Boolean(country)))].sort();
  const uniqueLanguages = [...new Set((approvedDomains?.map(domain => domain.language) ?? []).filter((language): language is string => Boolean(language)))].sort();

  if (error) return <ErrorBanner message="Failed to load sources." />;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-light tracking-tight text-foreground">Sources Manager</h1>
        <div className="flex gap-2">
          <button
            onClick={handleGlobalDiscovery}
            disabled={isDiscovering}
            className="px-3 py-2 rounded-xl bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 transition flex items-center gap-1.5"
          >
            {isDiscovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />}
            Discover Articles
          </button>
        </div>
      </div>

      {discoveryStatus && (
        <div className="monitor-card py-2.5 px-4 text-xs text-text-secondary flex items-center gap-2">
          <Radar className="w-3.5 h-3.5 text-accent" />
          {discoveryStatus}
        </div>
      )}

      {/* Tab controls */}
      <div className="segment-control max-w-sm">
        {(["sources", "domains", "discover"] as Tab[]).map(t => (
          <button key={t} className={`segment-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === "sources" ? "Active Sources" : t === "domains" ? "Domain Registry" : "Add Source"}
          </button>
        ))}
      </div>

      {/* ── ADD SOURCE TAB ── */}
      {tab === "discover" && (
        <div className="space-y-4">
          <div className="monitor-card space-y-3">
            <p className="section-label">Detect Source — URL, Feed, or Domain</p>
            <div className="flex gap-3 flex-wrap">
              <input
                value={inputUrl} onChange={e => setInputUrl(e.target.value)}
                placeholder="Enter RSS URL, sitemap URL, or domain (e.g. bbc.com)"
                onKeyDown={e => e.key === "Enter" && handleDiscover()}
                className="flex-[3] min-w-[240px] px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
              />
              <button onClick={handleDiscover} disabled={discovering}
                className="px-4 py-2.5 rounded-xl bg-bg-subtle text-foreground text-sm font-medium hover:opacity-90 transition flex items-center gap-2">
                {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Detect
              </button>
            </div>

            {discoveryResults && discoveryResults.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex gap-2 flex-wrap">
                  {discoveryResults.map((r, i) => {
                    const meta = SOURCE_TYPE_META[r.source_type] || SOURCE_TYPE_META.rss;
                    const Icon = meta.icon;
                    return (
                      <button key={i} onClick={() => setSelectedResult(r)}
                        className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition ${selectedResult === r ? "bg-accent/20 text-accent ring-1 ring-accent/30" : "bg-bg-subtle text-text-muted hover:text-foreground"}`}>
                        <Icon className="w-3 h-3" /> {meta.label}
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
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Source name"
                    className="flex-1 min-w-[140px] px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
                  <select value={newRegion} onChange={e => setNewRegion(e.target.value)}
                    className="px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                    {ALL_REGIONS.filter(r => r !== "all").map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button onClick={() => addMutation.mutate()}
                    className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Add Source
                  </button>
                </div>
              </div>
            )}
            {addError && <p className="text-xs text-negative">{addError}</p>}
          </div>

          {/* Bulk import */}
          <div className="monitor-card space-y-3">
            <p className="section-label">Bulk Import Domains</p>
            <p className="text-xs text-text-muted">Upload CSV or JSON with fields: name, domain, country_code, region, language, source_type, feed_url, active</p>
            <div className="flex gap-3">
              <input ref={fileInputRef} type="file" accept=".csv,.json" onChange={handleBulkImport} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2.5 rounded-xl bg-bg-subtle text-foreground text-sm hover:opacity-90 transition flex items-center gap-2">
                <Upload className="w-4 h-4" /> Import CSV / JSON
              </button>
              <button
                onClick={() => {
                  const csv = "name,domain,country_code,region,language,source_type,feed_url,active\nExample News,example.com,US,press,en,rss,https://example.com/feed,true";
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = "sources_template.csv"; a.click();
                }}
                className="px-4 py-2.5 rounded-xl bg-bg-subtle text-text-muted text-sm hover:opacity-90 transition flex items-center gap-2">
                <Download className="w-4 h-4" /> Download Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Shared Filters ── */}
      {tab !== "discover" && (
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex-1 min-w-[180px] max-w-xs">
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search sources..."
              className="w-full px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
          </div>
          <select value={region} onChange={e => setRegion(e.target.value)}
            className="px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
            {ALL_REGIONS.map(r => <option key={r} value={r}>{r === "all" ? "All Regions" : r.charAt(0).toUpperCase() + r.slice(1).replace("_", " ")}</option>)}
          </select>
          <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
            <option value="">All Countries</option>
            {uniqueCountries.map(c => <option key={c} value={c}>{FLAG[c] || "🌐"} {c}</option>)}
          </select>
          {tab === "domains" && (
            <select value={languageFilter} onChange={e => setLanguageFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="">All Languages</option>
              {uniqueLanguages.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          )}
        </div>
      )}

      {/* ── ACTIVE SOURCES TAB ── */}
      {tab === "sources" && (
        isLoading ? (
          <div className="space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="monitor-card h-14 animate-pulse" />)}
          </div>
        ) : Object.keys(groupedSources).length === 0 ? (
          <EmptyState message="No sources found" />
        ) : (
          (Object.entries(groupedSources) as [string, typeof filteredSources][]).map(([reg, list]) => (
            <div key={reg}>
              <p className="section-label mb-2">{reg.toUpperCase().replace("_", " ")}</p>
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
                            <Icon className="w-2.5 h-2.5 inline mr-0.5" />{meta.label}
                          </span>
                          {failures >= 4 && <span className="text-negative text-[10px] flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> Failing</span>}
                          {failures >= 1 && failures < 4 && <span className="text-[hsl(30,90%,60%)] text-[10px]">⚠ {failures} fail{failures > 1 ? "s" : ""}</span>}
                        </div>
                        <p className="text-xs text-text-muted truncate">{s.rss_url}</p>
                      </div>
                      <span className="text-xs text-text-muted whitespace-nowrap">
                        {s.last_fetched_at ? format(new Date(s.last_fetched_at), "MMM d HH:mm") : "Never"}
                      </span>
                      <div className={`w-2 h-2 rounded-full ${getHealthColor(s.health_status, failures)}`} />
                      <button onClick={() => toggleMutation.mutate({ id: s.id, active: s.active })}
                        className={`px-2.5 py-1 rounded-lg text-xs transition ${s.active ? 'bg-positive/15 text-positive' : 'bg-bg-subtle text-text-muted'}`}>
                        {s.active ? "On" : "Off"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${s.name}"?`)) deleteSourceMutation.mutate(s.id); }}
                        className="p-1.5 rounded-lg text-text-muted hover:text-negative hover:bg-negative/10 transition opacity-0 group-hover:opacity-100"
                        title="Delete source">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )
      )}

      {/* ── DOMAIN REGISTRY TAB ── */}
      {tab === "domains" && (
        domainsLoading ? (
          <div className="space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="monitor-card h-14 animate-pulse" />)}
          </div>
        ) : filteredDomains.length === 0 ? (
          <EmptyState message="No domains found" />
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-text-muted">{filteredDomains.length} domains in registry</p>

            {/* Pending approval section */}
            {filteredDomains.some(d => d.approval_status === "pending") && (
              <div>
                <p className="section-label mb-2 text-[hsl(30,90%,60%)]">PENDING APPROVAL</p>
                <div className="space-y-1.5">
                  {filteredDomains.filter(d => d.approval_status === "pending").map(d => (
                    <div key={d.id} className="monitor-card flex items-center gap-3 py-3">
                      <span className="text-lg">{FLAG[d.country_code] || "🌐"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-foreground font-light">{d.name}</p>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[hsl(30,90%,60%)]/15 text-[hsl(30,90%,60%)]">Pending</span>
                          <span className="text-[10px] text-text-muted">{d.language?.toUpperCase()}</span>
                        </div>
                        <p className="text-xs text-text-muted truncate">{d.domain}</p>
                      </div>
                      <span className="text-xs text-text-muted">{d.region}</span>
                      <button onClick={() => approveDomainMutation.mutate({ id: d.id, status: "approved" })}
                        className="p-1.5 rounded-lg bg-positive/15 text-positive hover:bg-positive/25 transition">
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button onClick={() => approveDomainMutation.mutate({ id: d.id, status: "rejected" })}
                        className="p-1.5 rounded-lg bg-negative/15 text-negative hover:bg-negative/25 transition">
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approved domains grouped by region */}
            {Object.entries(
              filteredDomains
                .filter(d => d.approval_status === "approved")
                .reduce<Record<string, any[]>>((acc, d) => { (acc[d.region] ??= []).push(d); return acc; }, {})
            ).map(([reg, list]) => (
              <div key={reg}>
                <p className="section-label mb-2">{reg.toUpperCase().replace("_", " ")} ({list.length})</p>
                <div className="space-y-1">
                  {list.map(d => {
                    const meta = SOURCE_TYPE_META[d.source_type] || SOURCE_TYPE_META.rss;
                    const Icon = meta.icon;
                    const isActive = sources?.some(s => s.rss_url === d.feed_url || (s as any).domain === d.domain);
                    return (
                      <div key={d.id} className="monitor-card flex items-center gap-3 py-2.5">
                        <span className="text-base">{FLAG[d.country_code] || "🌐"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-foreground font-light">{d.name}</p>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${meta.color}`}>
                              <Icon className="w-2.5 h-2.5 inline mr-0.5" />{meta.label}
                            </span>
                            <span className="text-[10px] text-text-muted">{d.language?.toUpperCase()}</span>
                            {isActive && <span className="text-[10px] text-positive">● Active</span>}
                          </div>
                          <p className="text-xs text-text-muted truncate">{d.domain}{d.feed_url ? ` · ${d.feed_url.slice(0, 60)}...` : ""}</p>
                        </div>
                        {!isActive && d.feed_url && (
                          <button onClick={() => promoteMutation.mutate(d)}
                            className="px-2.5 py-1 rounded-lg text-xs bg-accent/15 text-accent hover:bg-accent/25 transition">
                            + Add
                          </button>
                        )}
                        <button onClick={() => toggleDomainMutation.mutate({ id: d.id, active: d.active })}
                          className={`px-2 py-1 rounded-lg text-xs transition ${d.active ? 'bg-positive/15 text-positive' : 'bg-bg-subtle text-text-muted'}`}>
                          {d.active ? "On" : "Off"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
