import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { X, ExternalLink, User, Mail, Globe, Quote, Loader2, Sparkles, Twitter, Linkedin, Bookmark, Tag, StickyNote, Plus } from "lucide-react";
import { useBookmarks, useArticleTags, useArticleNotes } from "@/hooks/useArticleActions";

interface ArticleDetailDrawerProps {
  article: any;
  onClose: () => void;
}

export default function ArticleDetailDrawer({ article, onClose }: ArticleDetailDrawerProps) {
  const src = article.sources as any;
  const displayName = src?.name || article.source_name || article.source_domain || "Unknown";

  const { isBookmarked, toggleBookmark } = useBookmarks();
  const { tags, addTag } = useArticleTags(article.id);
  const { notes, addNote } = useArticleNotes(article.id);
  const [newTag, setNewTag] = useState("");
  const [newNote, setNewNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);

  const { data: enrichment, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["article-enrichment", article.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("enrich-article", { body: { article_id: article.id } });
      if (error) throw error;
      return data?.data || null;
    },
    enabled: false,
  });

  const [enrichTriggered, setEnrichTriggered] = useState(false);
  const handleEnrich = () => { setEnrichTriggered(true); refetch(); };
  const enriching = isLoading || isRefetching;

  const handleAddTag = () => {
    if (!newTag.trim()) return;
    addTag({ articleId: article.id, tag: newTag.trim() });
    setNewTag("");
  };

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    addNote({ articleId: article.id, content: newNote.trim() });
    setNewNote("");
    setShowNoteInput(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-card border-l border-bg-subtle overflow-y-auto animate-slide-in-right" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-bg-subtle p-4 flex items-start justify-between gap-3 z-10">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground leading-snug">{article.title}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs text-text-secondary">{displayName}</span>
              {article.source_domain && <span className="text-[10px] text-text-muted">({article.source_domain})</span>}
              <span className="text-xs text-text-muted">·</span>
              <span className="text-xs text-text-muted">{format(new Date(article.published_at), "MMM d, yyyy HH:mm")}</span>
              <span className={`sentiment-badge text-[10px] ${article.sentiment === "positive" ? "sentiment-positive" : article.sentiment === "negative" ? "sentiment-negative" : "sentiment-neutral"}`}>
                {article.sentiment}
              </span>
              {article.language && <span className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted text-[10px]">{article.language}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => toggleBookmark(article.id)} className="p-1.5 rounded-lg hover:bg-bg-subtle transition">
              <Bookmark className={`w-4 h-4 ${isBookmarked(article.id) ? "fill-primary text-primary" : "text-text-muted"}`} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-subtle transition">
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>
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
            <div>
              <p className="section-label mb-1.5">Matched Keywords</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {article.matched_keywords.map((kw: string) => (
                  <span key={kw} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">{kw}</span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          <div>
            <p className="section-label mb-1.5 flex items-center gap-1"><Tag className="w-3 h-3" /> Tags</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {tags.map((t: any) => (
                <span key={t.id} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px]">{t.tag}</span>
              ))}
              <div className="flex items-center gap-1">
                <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Add tag…"
                  onKeyDown={e => e.key === "Enter" && handleAddTag()}
                  className="px-2 py-0.5 rounded-lg bg-bg-elevated border border-bg-subtle text-foreground text-[11px] w-20 focus:outline-none focus:ring-1 focus:ring-primary/50" />
                <button onClick={handleAddTag} className="p-0.5 rounded hover:bg-bg-subtle transition"><Plus className="w-3 h-3 text-text-muted" /></button>
              </div>
            </div>
          </div>

          {/* Open Article */}
          <a href={article.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-primary/10 text-primary text-xs hover:bg-primary/20 transition w-fit">
            <ExternalLink className="w-3.5 h-3.5" /> Open original article
          </a>

          {/* Notes */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="section-label flex items-center gap-1"><StickyNote className="w-3 h-3" /> Notes</p>
              <button onClick={() => setShowNoteInput(!showNoteInput)} className="text-[10px] text-primary hover:underline">+ Add note</button>
            </div>
            {showNoteInput && (
              <div className="mb-2 space-y-1.5">
                <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Write a note…" rows={3}
                  className="w-full px-3 py-2 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
                <div className="flex gap-1.5">
                  <button onClick={handleAddNote} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px]">Save</button>
                  <button onClick={() => setShowNoteInput(false)} className="px-3 py-1.5 rounded-lg bg-bg-subtle text-text-muted text-[11px]">Cancel</button>
                </div>
              </div>
            )}
            {notes.length > 0 && (
              <div className="space-y-1.5">
                {notes.map((n: any) => (
                  <div key={n.id} className="px-3 py-2 rounded-xl bg-bg-elevated text-xs text-text-secondary">
                    <p>{n.content}</p>
                    <p className="text-[10px] text-text-muted mt-1">{format(new Date(n.created_at), "MMM d, HH:mm")}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

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
              <p className="text-xs text-text-muted">Scanning article…</p>
            </div>
          )}

          {/* Enrichment Results */}
          {enrichment && !enriching && (
            <div className="space-y-3 animate-fade-in">
              {enrichment.author_name && (
                <div className="monitor-card space-y-2.5">
                  <p className="section-label">Author</p>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium">{enrichment.author_name}</p>
                      {enrichment.author_bio && <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{enrichment.author_bio}</p>}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {enrichment.author_email && (
                          <a href={`mailto:${enrichment.author_email}`} className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-primary transition">
                            <Mail className="w-3 h-3" /> {enrichment.author_email}
                          </a>
                        )}
                        {enrichment.author_url && (
                          <a href={enrichment.author_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-primary transition">
                            <Globe className="w-3 h-3" /> Profile
                          </a>
                        )}
                        {enrichment.author_social?.twitter && (
                          <a href={enrichment.author_social.twitter} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-primary transition">
                            <Twitter className="w-3 h-3" /> Twitter
                          </a>
                        )}
                        {enrichment.author_social?.linkedin && (
                          <a href={enrichment.author_social.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-primary transition">
                            <Linkedin className="w-3 h-3" /> LinkedIn
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

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

              {enrichment.full_text && (
                <div className="monitor-card space-y-2">
                  <p className="section-label">AI Summary</p>
                  <p className="text-xs text-text-secondary leading-relaxed">{enrichment.full_text}</p>
                </div>
              )}

              {enrichment.comments?.length > 0 && enrichment.comments[0]?.text && (
                <div className="monitor-card space-y-2">
                  <p className="section-label">Comments / Discussion</p>
                  <p className="text-xs text-text-secondary leading-relaxed">{enrichment.comments[0].text}</p>
                </div>
              )}

              {!enrichment.author_name && (
                <div className="monitor-card">
                  <p className="text-xs text-text-muted text-center py-2">No author information could be extracted.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
