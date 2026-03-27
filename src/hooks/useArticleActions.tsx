import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useBookmarks() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: bookmarks = [] } = useQuery({
    queryKey: ["bookmarks", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("article_bookmarks").select("article_id").eq("user_id", user.id);
      return (data ?? []).map(b => b.article_id);
    },
    enabled: !!user,
  });

  const toggle = useMutation({
    mutationFn: async (articleId: string) => {
      if (!user) return;
      const isBookmarked = bookmarks.includes(articleId);
      if (isBookmarked) {
        await supabase.from("article_bookmarks").delete().eq("user_id", user.id).eq("article_id", articleId);
      } else {
        await supabase.from("article_bookmarks").insert({ user_id: user.id, article_id: articleId });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmarks"] }),
  });

  return { bookmarks, toggleBookmark: toggle.mutate, isBookmarked: (id: string) => bookmarks.includes(id) };
}

export function useArticleTags(articleId?: string) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: tags = [] } = useQuery({
    queryKey: ["article-tags", articleId, user?.id],
    queryFn: async () => {
      if (!user || !articleId) return [];
      const { data } = await supabase.from("article_tags").select("*").eq("user_id", user.id).eq("article_id", articleId);
      return data ?? [];
    },
    enabled: !!user && !!articleId,
  });

  const addTag = useMutation({
    mutationFn: async ({ articleId: aId, tag }: { articleId: string; tag: string }) => {
      if (!user) return;
      await supabase.from("article_tags").insert({ user_id: user.id, article_id: aId, tag: tag.trim() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["article-tags"] }),
    onError: () => toast.error("Tag already exists"),
  });

  return { tags, addTag: addTag.mutate };
}

export function useArticleNotes(articleId?: string) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: notes = [] } = useQuery({
    queryKey: ["article-notes", articleId, user?.id],
    queryFn: async () => {
      if (!user || !articleId) return [];
      const { data } = await supabase.from("article_notes").select("*").eq("user_id", user.id).eq("article_id", articleId).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user && !!articleId,
  });

  const addNote = useMutation({
    mutationFn: async ({ articleId: aId, content }: { articleId: string; content: string }) => {
      if (!user) return;
      await supabase.from("article_notes").insert({ user_id: user.id, article_id: aId, content: content.trim() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["article-notes"] });
      toast.success("Note added");
    },
  });

  return { notes, addNote: addNote.mutate };
}

export function useSavedSearches() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: searches = [] } = useQuery({
    queryKey: ["saved-searches", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("saved_searches").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const saveSearch = useMutation({
    mutationFn: async ({ name, query }: { name: string; query: any }) => {
      if (!user) return;
      await supabase.from("saved_searches").insert({ user_id: user.id, name, query });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      toast.success("Search saved");
    },
  });

  const deleteSearch = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("saved_searches").delete().eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches"] }),
  });

  return { searches, saveSearch: saveSearch.mutate, deleteSearch: deleteSearch.mutate };
}

export function useAlertRules() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["alert-rules", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("alert_rules").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const addRule = useMutation({
    mutationFn: async (rule: { name: string; rule_type: string; alert_category?: string; conditions: any; digest_schedule?: string; webhook_url?: string }) => {
      if (!user) return;
      await supabase.from("alert_rules").insert({ user_id: user.id, ...rule });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
      toast.success("Alert rule created");
    },
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      await supabase.from("alert_rules").update({ active: !active }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("alert_rules").delete().eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });

  return { rules, isLoading, addRule: addRule.mutate, toggleRule: toggleRule.mutate, deleteRule: deleteRule.mutate };
}

export function useReportTemplates() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["report-templates", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("report_templates").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const addTemplate = useMutation({
    mutationFn: async (t: { name: string; description?: string; filters: any; schedule?: string }) => {
      if (!user) return;
      await supabase.from("report_templates").insert({ user_id: user.id, ...t });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-templates"] });
      toast.success("Report template created");
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("report_templates").delete().eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-templates"] }),
  });

  return { templates, isLoading, addTemplate: addTemplate.mutate, deleteTemplate: deleteTemplate.mutate };
}
