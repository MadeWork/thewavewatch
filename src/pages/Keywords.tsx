import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Star, Sparkles, Loader2, X } from "lucide-react";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { toast } from "sonner";

const TAG_COLORS = ["#5b9cf6", "#34d399", "#f87171", "#fbbf24", "#a78bfa", "#f472b6"];

interface Suggestion {
  keyword: string;
  reason: string;
}

export default function Keywords() {
  const queryClient = useQueryClient();
  const [newKeyword, setNewKeyword] = useState("");
  const [newLogic, setNewLogic] = useState("OR");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data: keywords, isLoading, error } = useQuery({
    queryKey: ["keywords"],
    queryFn: async () => {
      const { data, error } = await supabase.from("keywords").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const addMutation = useMutation({
    mutationFn: async (text?: string) => {
      const keyword = text || newKeyword.trim();
      if (!keyword) return;
      const { error } = await supabase.from("keywords").insert({ text: keyword, logic_operator: newLogic, color_tag: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["keywords"] }); setNewKeyword(""); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("keywords").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keywords"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("keywords").update({ active: !active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keywords"] }),
  });

  const favoriteMutation = useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => {
      const { error } = await supabase.from("keywords").update({ favorite: !favorite }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keywords"] }),
  });

  const suggestMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("suggest-keywords");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.suggestions as Suggestion[];
    },
    onSuccess: (data) => {
      setSuggestions(data || []);
      setShowSuggestions(true);
      if (!data?.length) toast.info("No new suggestions — your keywords look comprehensive!");
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to get suggestions");
    },
  });

  const handleAddSuggestion = (keyword: string) => {
    addMutation.mutate(keyword);
    setSuggestions(prev => prev.filter(s => s.keyword !== keyword));
    toast.success(`Added "${keyword}"`);
  };

  // Fake sparkline data
  const sparkline = () => Array.from({ length: 7 }, () => ({ v: Math.floor(Math.random() * 20) }));

  if (error) return <ErrorBanner message="Failed to load keywords." />;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-light tracking-tight text-foreground">Keyword Manager</h1>
        <button
          onClick={() => suggestMutation.mutate()}
          disabled={suggestMutation.isPending || !keywords?.length}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/15 text-accent text-sm font-medium hover:bg-accent/25 transition disabled:opacity-50"
        >
          {suggestMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          AI Suggest
        </button>
      </div>

      {/* AI Suggestions panel */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="monitor-card border border-accent/20 bg-accent/5">
          <div className="flex items-center justify-between mb-3">
            <p className="section-label flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              AI Suggestions
            </p>
            <button onClick={() => setShowSuggestions(false)} className="p-1 rounded-lg hover:bg-bg-subtle transition">
              <X className="w-3.5 h-3.5 text-text-muted" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <button
                key={s.keyword}
                onClick={() => handleAddSuggestion(s.keyword)}
                className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-elevated border border-bg-subtle text-sm text-foreground hover:border-accent/40 hover:bg-accent/10 transition"
                title={s.reason}
              >
                <Plus className="w-3 h-3 text-text-muted group-hover:text-accent transition" />
                {s.keyword}
                <span className="text-[10px] text-text-muted ml-1 max-w-[120px] truncate">{s.reason}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add keyword */}
      <div className="monitor-card">
        <p className="section-label mb-3">Add Keyword</p>
        <div className="flex gap-3">
          <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
            placeholder="Enter keyword…"
            onKeyDown={e => e.key === "Enter" && addMutation.mutate(undefined)}
            className="flex-1 px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
          <div className="segment-control">
            {["AND", "OR", "NOT"].map(op => (
              <button key={op} className={`segment-btn ${newLogic === op ? 'active' : ''}`} onClick={() => setNewLogic(op)}>
                {op}
              </button>
            ))}
          </div>
          <button onClick={() => addMutation.mutate(undefined)} disabled={!newKeyword.trim()}
            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Keyword list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="monitor-card h-16 animate-pulse" />)}
        </div>
      ) : !keywords?.length ? (
        <EmptyState message="No keywords added yet" />
      ) : (
        <div className="space-y-2">
          {keywords.map(kw => (
            <div key={kw.id} className="monitor-card flex items-center gap-4">
              <button
                onClick={() => favoriteMutation.mutate({ id: kw.id, favorite: (kw as any).favorite ?? false })}
                className="p-1 rounded-lg transition hover:bg-bg-subtle"
                title={((kw as any).favorite) ? "Remove from favorites" : "Add to favorites"}
              >
                <Star
                  className={`w-4 h-4 transition ${(kw as any).favorite ? 'fill-yellow-400 text-yellow-400' : 'text-text-muted'}`}
                />
              </button>
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: kw.color_tag || "#5b9cf6" }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground font-light">{kw.text}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] text-text-muted bg-bg-subtle">{kw.logic_operator}</span>
                </div>
                <span className="text-xs text-text-muted">{kw.match_count} matches</span>
              </div>
              <div className="w-20 h-6">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparkline()}>
                    <Line type="monotone" dataKey="v" stroke={kw.color_tag || "#5b9cf6"} strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <button onClick={() => toggleMutation.mutate({ id: kw.id, active: kw.active })}
                className={`px-2.5 py-1 rounded-lg text-xs transition ${kw.active ? 'bg-positive/15 text-positive' : 'bg-bg-subtle text-text-muted'}`}>
                {kw.active ? "Active" : "Paused"}
              </button>
              <button onClick={() => deleteMutation.mutate(kw.id)}
                className="p-2 rounded-lg text-text-muted hover:text-negative hover:bg-negative/10 transition">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
