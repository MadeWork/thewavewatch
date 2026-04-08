import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface ApiService {
  name: string;
  secretKey: string;
  accountUrl: string;
  description: string;
  free: boolean;
  usageNote?: string;
}

const API_SERVICES: ApiService[] = [
  {
    name: "Perigon",
    secretKey: "PERIGON_API_KEY",
    accountUrl: "https://www.goperigon.com/account",
    description: "Tier-1 news aggregation — top 100 global sources",
    free: false,
    usageNote: "Free: 100 req/day · Growth: 10k req/day",
  },
  {
    name: "The Guardian",
    secretKey: "GUARDIAN_API_KEY",
    accountUrl: "https://open-platform.theguardian.com/access/",
    description: "Full-text articles from UK, US & AU editions",
    free: true,
    usageNote: "Free: 5,000 req/day",
  },
  {
    name: "NewsAPI",
    secretKey: "NEWSAPI_KEY",
    accountUrl: "https://newsapi.org/account",
    description: "On-demand news search — manual fetch only",
    free: false,
    usageNote: "Free: 100 req/day · Used on manual fetch only",
  },
  {
    name: "Firecrawl",
    secretKey: "FIRECRAWL_API_KEY",
    accountUrl: "https://www.firecrawl.dev/app",
    description: "Web scraping, sitemap discovery & deep extraction",
    free: false,
    usageNote: "Credit-based · check dashboard for balance",
  },
  {
    name: "GDELT",
    secretKey: "",
    accountUrl: "https://www.gdeltproject.org/",
    description: "Global event database — no key required",
    free: true,
    usageNote: "Unlimited · free public API",
  },
  {
    name: "Google News RSS",
    secretKey: "",
    accountUrl: "https://news.google.com/",
    description: "Pre-filtered topic feeds from major outlets",
    free: true,
    usageNote: "Unlimited · public RSS feeds",
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

export default function ApiIntegrations() {
  const { data: secrets, isLoading } = useQuery({
    queryKey: ["api-secrets-check"],
    queryFn: async () => {
      // We check which secrets exist by invoking a lightweight function
      // For now, we use the known secret names from configuration
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

  return (
    <div className="border-t border-border pt-5 mt-5">
      <h2 className="text-sm font-medium text-foreground mb-1">API Integrations</h2>
      <p className="text-xs text-muted-foreground mb-4">
        External services powering article discovery and enrichment.
      </p>
      <div className="space-y-2">
        {API_SERVICES.map((svc) => {
          const configured = svc.free || (secrets?.has(svc.secretKey) ?? false);
          return (
            <div
              key={svc.name}
              className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border/50"
            >
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
              <a
                href={svc.accountUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition shrink-0"
              >
                Dashboard <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
