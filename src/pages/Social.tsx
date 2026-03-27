import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Search, ExternalLink, MessageCircle } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";

const PLATFORM_COLORS: Record<string, string> = {
  twitter: "bg-sky-500/15 text-sky-400",
  x: "bg-sky-500/15 text-sky-400",
  linkedin: "bg-blue-600/15 text-blue-400",
  reddit: "bg-orange-500/15 text-orange-400",
  youtube: "bg-red-500/15 text-red-400",
  facebook: "bg-indigo-500/15 text-indigo-400",
};

function getPlatformFromDomain(domain: string | null): string {
  if (!domain) return "unknown";
  const d = domain.toLowerCase();
  if (d.includes("twitter") || d.includes("x.com")) return "x";
  if (d.includes("linkedin")) return "linkedin";
  if (d.includes("reddit")) return "reddit";
  if (d.includes("youtube")) return "youtube";
  if (d.includes("facebook") || d.includes("fb.com")) return "facebook";
  return "social";
}

export default function Social() {
  const [quickSearch, setQuickSearch] = useState("");

  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["social-mentions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("source_category", "social" as any)
        .order("published_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = useMemo(() => {
    let result = articles ?? [];
    if (quickSearch) {
      const q = quickSearch.toLowerCase();
      result = result.filter(a => a.title.toLowerCase().includes(q) || a.snippet?.toLowerCase().includes(q));
    }
    return result;
  }, [articles, quickSearch]);

  if (error) return <ErrorBanner message="Failed to load social mentions." />;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <MessageCircle className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-light tracking-tight text-foreground">Social Mentions</h1>
        <span className="text-xs text-muted-foreground">({filtered.length})</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Social mentions are tracked separately from the main media feed. Only high-signal keywords (company names, exec names, products) are monitored here.
      </p>

      {/* Quick search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={quickSearch}
          onChange={e => setQuickSearch(e.target.value)}
          placeholder="Search social mentions…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="monitor-card h-16 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message="No social mentions yet. Enable 'Monitor in Social' on keywords to start tracking." />
      ) : (
        <div className="space-y-2">
          {filtered.map(a => {
            const platform = getPlatformFromDomain(a.source_domain);
            const colorClass = PLATFORM_COLORS[platform] || "bg-bg-subtle text-muted-foreground";
            return (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="monitor-card flex items-start gap-3 hover:bg-bg-elevated/80 transition group"
              >
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium uppercase ${colorClass} flex-shrink-0 mt-0.5`}>
                  {platform}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-light group-hover:text-primary transition truncate">
                    {a.title}
                  </p>
                  {a.snippet && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.snippet}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(a.published_at), "MMM d, yyyy HH:mm")}
                    </span>
                    {a.matched_keywords?.map((kw: string) => (
                      <span key={kw} className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
                <span
                  className={`sentiment-badge text-[10px] ${
                    a.sentiment === "positive"
                      ? "sentiment-positive"
                      : a.sentiment === "negative"
                      ? "sentiment-negative"
                      : "sentiment-neutral"
                  }`}
                >
                  {a.sentiment}
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition mt-0.5 flex-shrink-0" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
