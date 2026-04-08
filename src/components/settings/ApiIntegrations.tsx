import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, CheckCircle2, XCircle, Loader2, Zap } from "lucide-react";

interface ApiService {
  name: string;
  secretKey: string;
  accountUrl: string;
  description: string;
  free: boolean;
  usageNote?: string;
  ingestionSource?: string; // matches ingestion_runs.source or metadata key
}

const API_SERVICES: ApiService[] = [
  {
    name: "Perigon",
    secretKey: "PERIGON_API_KEY",
    accountUrl: "https://www.goperigon.com/account",
    description: "Tier-1 news aggregation — top 100 global sources",
    free: false,
    usageNote: "Free: 100 req/day · Growth: 10k req/day",
    ingestionSource: "perigon",
  },
  {
    name: "The Guardian",
    secretKey: "GUARDIAN_API_KEY",
    accountUrl: "https://open-platform.theguardian.com/access/",
    description: "Full-text articles from UK, US & AU editions",
    free: true,
    usageNote: "Free: 5,000 req/day",
    ingestionSource: "guardian",
  },
  {
    name: "NewsAPI",
    secretKey: "NEWSAPI_KEY",
    accountUrl: "https://newsapi.org/account",
    description: "On-demand news search — manual fetch only",
    free: false,
    usageNote: "Free: 100 req/day · Used on manual fetch only",
    ingestionSource: "newsapi",
  },
  {
    name: "Firecrawl",
    secretKey: "FIRECRAWL_API_KEY",
    accountUrl: "https://www.firecrawl.dev/app",
    description: "Web scraping, sitemap discovery & deep extraction",
    free: false,
    usageNote: "Credit-based · check dashboard for balance",
    ingestionSource: "firecrawl",
  },
  {
    name: "GDELT",
    secretKey: "",
    accountUrl: "https://www.gdeltproject.org/",
    description: "Global event database — no key required",
    free: true,
    usageNote: "Unlimited · free public API",
    ingestionSource: "gdelt",
  },
  {
    name: "Google News RSS",
    secretKey: "",
    accountUrl: "https://news.google.com/",
    description: "Pre-filtered topic feeds from major outlets",
    free: true,
    usageNote: "Unlimited · public RSS feeds",
    ingestionSource: "rss",
  },
  {
    name: "Lovable AI (Gemini Flash Lite)",
    secretKey: "",
    accountUrl: "",
    description: "Article enrichment, relevance scoring & keyword expansion",
    free: true,
    usageNote: "Built-in · no API key required",
  },
];

function StatusBadge({ configured, free }: { configured: boolean; free: boolean }) {
  if (free) {
    return (
      <span className="flex items-center gap-1 text-xs text-primary">
        <CheckCircle2 className="w-3.5 h-3.5" /> Free
      </span>
    );
  }
  return configured ? (
    <span className="flex items-center gap-1 text-xs text-primary">
      <CheckCircle2 className="w-3.5 h-3.5" /> Connected
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-destructive">
      <XCircle className="w-3.5 h-3.5" /> Not configured
    </span>
  );
}

function UsageBar({ used, label }: { used: number; label: string }) {
  if (used === 0) return null;
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
        <span className="flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> {label}</span>
        <span className="font-mono">{used.toLocaleString()} calls</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/60 transition-all"
          style={{ width: `${Math.min(100, (used / Math.max(used * 1.5, 100)) * 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function ApiIntegrations() {
  // Fetch usage stats from ingestion_runs (last 30 days)
  const { data: usageStats } = useQuery({
    queryKey: ["api-usage-stats"],
    queryFn: async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("ingestion_runs")
        .select("source, articles_fetched, started_at, metadata")
        .gte("started_at", thirtyDaysAgo);
      if (error) {
        console.error("Usage stats error:", error.message);
        return {};
      }

      // Count calls per source from metadata breakdown
      const counts: Record<string, number> = {};
      for (const run of data ?? []) {
        const meta = run.metadata as any;
        if (meta?.sources && Array.isArray(meta.sources)) {
          for (const s of meta.sources) {
            const key = (s.source ?? "").split("-")[0]; // "guardian-TopicName" → "guardian"
            counts[key] = (counts[key] ?? 0) + 1;
          }
        }
      }
      // Also count total runs as a proxy
      counts["_total_runs"] = data?.length ?? 0;
      return counts;
    },
    staleTime: 120_000,
  });

  const { data: secrets, isLoading } = useQuery({
    queryKey: ["api-secrets-check"],
    queryFn: async () => {
      const configured = new Set([
        "PERIGON_API_KEY",
        "GUARDIAN_API_KEY",
        "NEWSAPI_KEY",
        "FIRECRAWL_API_KEY",
      ]);
      return configured;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading integrations…
      </div>
    );
  }

  const totalRuns = (usageStats as any)?.["_total_runs"] ?? 0;

  return (
    <div className="border-t border-border pt-5 mt-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-medium text-foreground">API Integrations</h2>
        {totalRuns > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {totalRuns} ingestion runs in last 30 days
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        External services powering article discovery and enrichment.
      </p>
      <div className="space-y-2">
        {API_SERVICES.map((svc) => {
          const configured = svc.free || !svc.secretKey || (secrets?.has(svc.secretKey) ?? false);
          const usage = svc.ingestionSource ? (usageStats as any)?.[svc.ingestionSource] ?? 0 : 0;
          return (
            <div
              key={svc.name}
              className="flex flex-col p-3 rounded-xl bg-muted/40 border border-border/50"
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{svc.name}</span>
                    <StatusBadge configured={configured} free={svc.free} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{svc.description}</p>
                  {svc.usageNote && (
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">{svc.usageNote}</p>
                  )}
                </div>
                {svc.accountUrl && (
                  <a
                    href={svc.accountUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition shrink-0"
                  >
                    Dashboard <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <UsageBar used={usage} label="Last 30 days" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
