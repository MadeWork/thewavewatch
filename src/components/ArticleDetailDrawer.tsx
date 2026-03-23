import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { X, ExternalLink, User, Mail, Globe, Quote, Loader2, Sparkles, Twitter, Linkedin } from "lucide-react";

interface ArticleDetailDrawerProps {
  article: any;
  onClose: () => void;
}

export default function ArticleDetailDrawer({ article, onClose }: ArticleDetailDrawerProps) {
  const src = article.sources as any;
  const displayName = src?.name || article.source_name || article.source_domain || "Unknown";

  const { data: enrichment, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["article-enrichment", article.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("enrich-article", {
        body: { article_id: article.id },
      });
      if (error) throw error;
      return data?.data || null;
    },
    enabled: false,
  });

  const [enrichTriggered, setEnrichTriggered] = useState(false);

  const handleEnrich = () => {
    setEnrichTriggered(true);
    refetch();
  };

  const enriching = isLoading || isRefetching;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-bg-card border-l border-bg-subtle overflow-y-auto animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-bg-card/95 backdrop-blur-sm border-b border-bg-subtle p-4 flex items-start justify-between gap-3 z-10">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground leading-snug">{article.title}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs text-text-secondary">{displayName}</span>
              <span className="text-xs text-text-muted">·</span>
              <span className="text-xs text-text-muted">{format(new Date(article.published_at), "MMM d, yyyy")}</span>
              <span className={`sentiment-badge text-[10px] ${article.sentiment === 'positive' ? 'sentiment-positive' : article.sentiment === 'negative' ? 'sentiment-negative' : 'sentiment-neutral'}`}>
                {article.sentiment}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-subtle transition">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Snippet */}
          {article.snippet && (
            <div className="monitor-card">
              <p className="text-xs text-text-secondary leading-relaxed">{article.snippet}</p>
            </div>
          )}

          {/* Keywords */}
          {article.matched_keywords?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {article.matched_keywords.map((kw: string) => (
                <span key={kw} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">{kw}</span>
              ))}
            </div>
          )}

          {/* Open Article */}
          <a href={article.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-primary/10 text-primary text-xs hover:bg-primary/20 transition w-fit">
            <ExternalLink className="w-3.5 h-3.5" /> Open original article
          </a>

          {/* Enrich Button */}
          {!enrichTriggered && (
            <button onClick={handleEnrich}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/20 text-foreground text-sm hover:from-primary/30 hover:to-accent/30 transition">
              <Sparkles className="w-4 h-4 text-primary" />
              Deep scan — extract author & details
            </button>
          )}

          {/* Loading State */}
          {enriching && (
            <div className="monitor-card flex items-center justify-center gap-3 py-8">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <p className="text-xs text-text-muted">Scanning article for author info, key quotes & more…</p>
            </div>
          )}

          {/* Enrichment Results */}
          {enrichment && !enriching && (
            <div className="space-y-3 animate-fade-in">
              {/* Author Card */}
              {enrichment.author_name && (
                <div className="monitor-card space-y-2.5">
                  <p className="section-label">Author</p>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium">{enrichment.author_name}</p>
                      {enrichment.author_bio && (
                        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{enrichment.author_bio}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {enrichment.author_email && (
                          <a href={`mailto:${enrichment.author_email}`}
                            className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-primary transition">
                            <Mail className="w-3 h-3" /> {enrichment.author_email}
                          </a>
                        )}
                        {enrichment.author_url && (
                          <a href={enrichment.author_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-primary transition">
                            <Globe className="w-3 h-3" /> Profile
                          </a>
                        )}
                        {enrichment.author_social?.twitter && (
                          <a href={enrichment.author_social.twitter} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-primary transition">
                            <Twitter className="w-3 h-3" /> Twitter
                          </a>
                        )}
                        {enrichment.author_social?.linkedin && (
                          <a href={enrichment.author_social.linkedin} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-primary transition">
                            <Linkedin className="w-3 h-3" /> LinkedIn
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Key Quotes */}
              {enrichment.key_quotes?.length > 0 && (
                <div className="monitor-card space-y-2">
                  <p className="section-label">Key Quotes</p>
                  {enrichment.key_quotes.map((q: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 py-1.5">
                      <Quote className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-text-secondary leading-relaxed italic">"{q}"</p>
                    </div>
                  ))}
                </div>
              )}

              {/* AI Summary */}
              {enrichment.full_text && (
                <div className="monitor-card space-y-2">
                  <p className="section-label">AI Summary</p>
                  <p className="text-xs text-text-secondary leading-relaxed">{enrichment.full_text}</p>
                </div>
              )}

              {/* Comments Summary */}
              {enrichment.comments?.length > 0 && enrichment.comments[0]?.text && (
                <div className="monitor-card space-y-2">
                  <p className="section-label">Comments / Discussion</p>
                  <p className="text-xs text-text-secondary leading-relaxed">{enrichment.comments[0].text}</p>
                </div>
              )}

              {/* No author found */}
              {!enrichment.author_name && (
                <div className="monitor-card">
                  <p className="text-xs text-text-muted text-center py-2">No author information could be extracted from this article.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
