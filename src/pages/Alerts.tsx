import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Plus, Trash2, X, Zap, Clock, Globe } from "lucide-react";
import { useAlertRules } from "@/hooks/useArticleActions";
import EmptyState from "@/components/EmptyState";

export default function Alerts() {
  const { rules, isLoading, addRule, toggleRule, deleteRule } = useAlertRules();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    rule_type: "instant",
    keywords: [] as string[],
    sentiments: [] as string[],
    sources: [] as string[],
    countries: [] as string[],
    digest_schedule: "daily",
    webhook_url: "",
  });
  const [kwInput, setKwInput] = useState("");

  const { data: keywords } = useQuery({
    queryKey: ["keywords-texts-alert"],
    queryFn: async () => {
      const { data } = await supabase.from("keywords").select("text").eq("active", true);
      return data?.map(k => k.text) ?? [];
    },
  });

  const handleCreate = () => {
    if (!form.name.trim()) return;
    addRule({
      name: form.name.trim(),
      rule_type: form.rule_type,
      conditions: {
        keywords: form.keywords,
        sentiments: form.sentiments,
        sources: form.sources,
        countries: form.countries,
      },
      digest_schedule: form.rule_type === "digest" ? form.digest_schedule : undefined,
      webhook_url: form.webhook_url || undefined,
    });
    setForm({ name: "", rule_type: "instant", keywords: [], sentiments: [], sources: [], countries: [], digest_schedule: "daily", webhook_url: "" });
    setShowCreate(false);
  };

  const addKeyword = (kw: string) => {
    if (!form.keywords.includes(kw)) setForm(f => ({ ...f, keywords: [...f.keywords, kw] }));
  };

  const ruleTypeIcons: Record<string, typeof Bell> = { instant: Zap, digest: Clock, webhook: Globe };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-light tracking-tight text-foreground flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary" /> Alerts
        </h1>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition">
          <Plus className="w-3.5 h-3.5" /> New Alert Rule
        </button>
      </div>

      {showCreate && (
        <div className="monitor-card space-y-4">
          <p className="section-label">Create Alert Rule</p>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Alert name…"
            className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />

          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Alert Type</p>
            <div className="segment-control max-w-sm">
              {[{ v: "instant", l: "Instant" }, { v: "digest", l: "Digest" }, { v: "webhook", l: "Webhook" }].map(t => (
                <button key={t.v} className={`segment-btn ${form.rule_type === t.v ? "active" : ""}`} onClick={() => setForm(f => ({ ...f, rule_type: t.v }))}>{t.l}</button>
              ))}
            </div>
          </div>

          {form.rule_type === "digest" && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Schedule</p>
              <div className="segment-control max-w-sm">
                {["morning", "evening", "daily", "weekly"].map(s => (
                  <button key={s} className={`segment-btn ${form.digest_schedule === s ? "active" : ""}`} onClick={() => setForm(f => ({ ...f, digest_schedule: s }))}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {form.rule_type === "webhook" && (
            <input value={form.webhook_url} onChange={e => setForm(f => ({ ...f, webhook_url: e.target.value }))} placeholder="Webhook URL (Slack/Teams)…"
              className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          )}

          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Trigger Keywords</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(keywords ?? []).map(kw => (
                <button key={kw} onClick={() => addKeyword(kw)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] transition ${form.keywords.includes(kw) ? "bg-primary/20 text-primary" : "bg-bg-elevated text-text-muted hover:text-foreground"}`}>{kw}</button>
              ))}
            </div>
            {form.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {form.keywords.map(kw => (
                  <span key={kw} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px]">
                    {kw} <X className="w-2.5 h-2.5 cursor-pointer" onClick={() => setForm(f => ({ ...f, keywords: f.keywords.filter(k => k !== kw) }))} />
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Sentiment Triggers</p>
            <div className="flex gap-2">
              {["positive", "neutral", "negative"].map(s => (
                <button key={s} onClick={() => setForm(f => ({ ...f, sentiments: f.sentiments.includes(s) ? f.sentiments.filter(x => x !== s) : [...f.sentiments, s] }))}
                  className={`px-3 py-1.5 rounded-lg text-xs transition ${form.sentiments.includes(s) ? `${s === "positive" ? "bg-positive/20 text-positive" : s === "negative" ? "bg-negative/20 text-negative" : "bg-bg-subtle text-foreground"}` : "bg-bg-elevated text-text-muted"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={handleCreate} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition">Create Rule</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 rounded-xl bg-bg-elevated text-text-secondary text-sm hover:bg-bg-subtle transition">Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="monitor-card h-16 animate-pulse" />)}</div>
      ) : rules.length === 0 ? (
        <EmptyState message="No alert rules configured yet" />
      ) : (
        <div className="space-y-2">
          {rules.map((rule: any) => {
            const Icon = ruleTypeIcons[rule.rule_type] || Bell;
            const conditions = rule.conditions || {};
            return (
              <div key={rule.id} className="monitor-card flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-light">{rule.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded text-[10px] text-text-muted bg-bg-subtle">{rule.rule_type}</span>
                    {rule.digest_schedule && <span className="px-1.5 py-0.5 rounded text-[10px] text-text-muted bg-bg-subtle">{rule.digest_schedule}</span>}
                    {conditions.keywords?.map((kw: string) => (
                      <span key={kw} className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">{kw}</span>
                    ))}
                    {conditions.sentiments?.map((s: string) => (
                      <span key={s} className={`sentiment-badge text-[10px] ${s === "positive" ? "sentiment-positive" : s === "negative" ? "sentiment-negative" : "sentiment-neutral"}`}>{s}</span>
                    ))}
                  </div>
                </div>
                <button onClick={() => toggleRule({ id: rule.id, active: rule.active })}
                  className={`px-2.5 py-1 rounded-lg text-xs transition ${rule.active ? "bg-positive/15 text-positive" : "bg-bg-subtle text-text-muted"}`}>
                  {rule.active ? "Active" : "Paused"}
                </button>
                <button onClick={() => deleteRule(rule.id)} className="p-2 rounded-lg text-text-muted hover:text-negative hover:bg-negative/10 transition">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
