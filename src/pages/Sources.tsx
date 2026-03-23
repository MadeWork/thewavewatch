import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus } from "lucide-react";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import { format } from "date-fns";

const FLAG: Record<string, string> = {
  US: "🇺🇸", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", QA: "🇶🇦", SE: "🇸🇪", JP: "🇯🇵", AU: "🇦🇺",
};

const REGIONS = ["all", "wire", "press", "business", "nordics"];

export default function Sources() {
  const queryClient = useQueryClient();
  const [region, setRegion] = useState("all");
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newRegion, setNewRegion] = useState("press");
  const [addError, setAddError] = useState("");

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
      if (!newName.trim() || !newUrl.trim()) { setAddError("Name and URL required"); return; }
      try { new URL(newUrl); } catch { setAddError("Invalid URL"); return; }
      const { error } = await supabase.from("sources").insert({ name: newName.trim(), rss_url: newUrl.trim(), region: newRegion });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["sources"] }); setNewName(""); setNewUrl(""); },
    onError: (e: any) => setAddError(e.message || "Failed to add"),
  });

  const filtered = (sources ?? []).filter(s => region === "all" || s.region === region);
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, s) => {
    (acc[s.region] ??= []).push(s);
    return acc;
  }, {});

  if (error) return <ErrorBanner message="Failed to load sources." />;

  return (
    <div className="space-y-5 animate-fade-in">
      <h1 className="text-xl font-light tracking-tight text-foreground">Sources Manager</h1>

      {/* Add source */}
      <div className="monitor-card space-y-3">
        <p className="section-label">Add Custom Source</p>
        <div className="flex gap-3 flex-wrap">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Source name"
            className="flex-1 min-w-[140px] px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
          <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="RSS URL"
            className="flex-[2] min-w-[200px] px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
          <select value={newRegion} onChange={e => setNewRegion(e.target.value)}
            className="px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
            {REGIONS.filter(r => r !== "all").map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={() => addMutation.mutate()}
            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition">
            <Plus className="w-4 h-4" />
          </button>
        </div>
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
              {list.map(s => (
                <div key={s.id} className="monitor-card flex items-center gap-3 py-3">
                  <span className="text-lg">{FLAG[s.country_code ?? ""] ?? "🌐"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-light">{s.name}</p>
                    <p className="text-xs text-text-muted truncate">{s.rss_url}</p>
                  </div>
                  <span className="text-xs text-text-muted">
                    {s.last_fetched_at ? format(new Date(s.last_fetched_at), "MMM d HH:mm") : "Never"}
                  </span>
                  <div className={`w-2 h-2 rounded-full ${s.health_status === 'healthy' ? 'bg-positive' : s.health_status === 'error' ? 'bg-negative' : 'bg-neutral-sentiment'}`} />
                  <button onClick={() => toggleMutation.mutate({ id: s.id, active: s.active })}
                    className={`px-2.5 py-1 rounded-lg text-xs transition ${s.active ? 'bg-positive/15 text-positive' : 'bg-bg-subtle text-text-muted'}`}>
                    {s.active ? "On" : "Off"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
