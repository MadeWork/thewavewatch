import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ErrorBanner from "@/components/ErrorBanner";

const CLEAR_OPTIONS = [
  { key: "mentions", label: "Mentions", tables: ["article_enrichments", "article_bookmarks", "article_tags", "article_notes", "articles"] as const },
  { key: "keywords", label: "Keywords", tables: ["keyword_groups", "keywords"] as const },
  { key: "sources", label: "Sources", tables: ["sources"] as const },
  { key: "domains", label: "Domain Registry", tables: ["approved_domains"] as const },
  { key: "alerts", label: "Alert Rules", tables: ["alert_rules"] as const },
  { key: "reports", label: "Report Templates", tables: ["report_templates"] as const },
  { key: "searches", label: "Saved Searches", tables: ["saved_searches"] as const },
];

function ClearDataButton() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clearing, setClearing] = useState(false);
  const queryClient = useQueryClient();

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      const tables = CLEAR_OPTIONS
        .filter(o => selected.has(o.key))
        .flatMap(o => o.tables);
      for (const table of tables) {
        await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      }
      queryClient.invalidateQueries();
      toast.success(`Cleared: ${CLEAR_OPTIONS.filter(o => selected.has(o.key)).map(o => o.label).join(", ")}`);
      setSelected(new Set());
      setOpen(false);
    } catch {
      toast.error("Failed to clear data");
    } finally {
      setClearing(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-xl border border-destructive text-destructive text-sm font-medium hover:bg-destructive/10 transition">
        Clear Data…
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Select what to clear:</p>
      <div className="flex flex-wrap gap-2">
        {CLEAR_OPTIONS.map(o => (
          <button key={o.key} onClick={() => toggle(o.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              selected.has(o.key)
                ? "bg-destructive text-destructive-foreground border-destructive"
                : "bg-muted text-muted-foreground border-border hover:border-destructive/50"
            }`}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={handleClear} disabled={clearing || selected.size === 0}
          className="px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
          {clearing ? "Clearing…" : `Delete ${selected.size} selected`}
        </button>
        <button onClick={() => { setOpen(false); setSelected(new Set()); }}
          className="px-4 py-2 rounded-xl bg-muted text-muted-foreground text-sm hover:opacity-90 transition">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").limit(1).single();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState({
    company_name: "",
    company_logo_url: "",
    digest_email: "",
    fetch_frequency_minutes: 60,
    timezone: "UTC",
  });

  useEffect(() => {
    if (settings) {
      setForm({
        company_name: settings.company_name || "",
        company_logo_url: settings.company_logo_url || "",
        digest_email: settings.digest_email || "",
        fetch_frequency_minutes: settings.fetch_frequency_minutes || 60,
        timezone: settings.timezone || "UTC",
      });
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!settings?.id) return;
      const { error } = await supabase.from("settings").update(form).eq("id", settings.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  const [saved, setSaved] = useState(false);
  const handleSave = () => {
    mutation.mutate();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (error) return <ErrorBanner message="Failed to load settings." />;

  const FREQS = [
    { value: 15, label: "15 min" },
    { value: 60, label: "1 hour" },
    { value: 360, label: "6 hours" },
  ];

  return (
    <div className="space-y-5 animate-fade-in max-w-2xl">
      <h1 className="text-xl font-light tracking-tight text-foreground">Settings</h1>

      {isLoading ? (
        <div className="monitor-card animate-pulse h-80" />
      ) : (
        <div className="monitor-card space-y-5">
          <div>
            <label className="section-label block mb-1.5">Company Name</label>
            <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
          </div>

          <div>
            <label className="section-label block mb-1.5">Company Logo URL</label>
            <input value={form.company_logo_url} onChange={e => setForm(f => ({ ...f, company_logo_url: e.target.value }))}
              placeholder="https://…"
              className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
          </div>

          <div>
            <label className="section-label block mb-1.5">Digest Email</label>
            <input type="email" value={form.digest_email} onChange={e => setForm(f => ({ ...f, digest_email: e.target.value }))}
              placeholder="team@company.com"
              className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
          </div>

          <div>
            <label className="section-label block mb-1.5">Fetch Frequency</label>
            <div className="segment-control max-w-xs">
              {FREQS.map(f => (
                <button key={f.value} className={`segment-btn ${form.fetch_frequency_minutes === f.value ? 'active' : ''}`}
                  onClick={() => setForm(prev => ({ ...prev, fetch_frequency_minutes: f.value }))}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="section-label block mb-1.5">Timezone</label>
            <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
              {["UTC", "Europe/London", "Europe/Stockholm", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"].map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={handleSave} disabled={mutation.isPending}
              className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
              {mutation.isPending ? "Saving…" : "Save Changes"}
            </button>
            {saved && <span className="text-xs text-positive">Settings saved!</span>}
          </div>

          <div className="border-t border-border pt-5 mt-5">
            <h2 className="text-sm font-medium text-destructive mb-2">Danger Zone</h2>
            <p className="text-xs text-muted-foreground mb-3">This will permanently delete all articles, enrichments, and sources. Keywords and settings will be kept.</p>
            <ClearDataButton />
          </div>
        </div>
      )}
    </div>
  );
}
