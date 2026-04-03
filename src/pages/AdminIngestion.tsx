import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { formatDistanceToNow, format, differenceInSeconds } from "date-fns";
import { useState } from "react";
import { Activity, Clock, FileText, AlertTriangle, Radio, Play, RefreshCw, Tag, History, Search, Plus, X, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export default function AdminIngestion() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [triggeringAll, setTriggeringAll] = useState(false);
  const [triggeringTopic, setTriggeringTopic] = useState<string | null>(null);
  const [backfillTopicId, setBackfillTopicId] = useState<string>("");
  const [backfillDays, setBackfillDays] = useState(30);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<any>(null);
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicKeywords, setNewTopicKeywords] = useState("");
  const [savingTopic, setSavingTopic] = useState(false);

  // Pipeline health
  const { data: health } = useQuery({
    queryKey: ["pipeline-health"],
    queryFn: async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 86400000).toISOString();

      const [totalRes, recentRes, lastRunRes, topicsRes, failedRes, rssRes] = await Promise.all([
        supabase.from("articles").select("id", { count: "exact", head: true }).not("topic_id", "is", null),
        supabase.from("articles").select("id", { count: "exact", head: true }).not("topic_id", "is", null).gte("created_at", yesterday),
        supabase.from("ingestion_runs").select("completed_at, status").eq("status", "success").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("monitored_topics").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("ingestion_runs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("started_at", yesterday),
        supabase.from("approved_domains").select("id", { count: "exact", head: true }).not("feed_url", "is", null).eq("active", true),
      ]);

      return {
        totalArticles: totalRes.count ?? 0,
        last24h: recentRes.count ?? 0,
        lastSuccess: lastRunRes.data?.completed_at ?? null,
        activeTopics: topicsRes.count ?? 0,
        failedRuns24h: failedRes.count ?? 0,
        rssFeeds: rssRes.count ?? 0,
      };
    },
    refetchInterval: 30000,
  });

  // Ingestion runs
  const { data: runs } = useQuery({
    queryKey: ["ingestion-runs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ingestion_runs")
        .select("*, monitored_topics(name)")
        .order("started_at", { ascending: false })
        .limit(5);
      return (data as any[]) ?? [];
    },
    refetchInterval: 30000,
  });

  const saveTopic = async () => {
    if (!newTopicName.trim() || !newTopicKeywords.trim() || !user) return;
    setSavingTopic(true);
    try {
      const keywords = newTopicKeywords.split(",").map(k => k.trim()).filter(Boolean);
      const { error } = await supabase.from("monitored_topics").insert({
        name: newTopicName.trim(),
        keywords,
        user_id: user.id,
      });
      if (error) throw error;
      toast.success(`Topic "${newTopicName.trim()}" created`);
      setNewTopicName("");
      setNewTopicKeywords("");
      setShowAddTopic(false);
      queryClient.invalidateQueries({ queryKey: ["monitored-topics-admin"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-health"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save topic");
    } finally {
      setSavingTopic(false);
    }
  };

  // Topics with article counts
  const { data: topics } = useQuery({
    queryKey: ["monitored-topics-admin"],
    queryFn: async () => {
      const { data: topicsData } = await supabase
        .from("monitored_topics")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (!topicsData) return [];

      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const enriched = await Promise.all(
        topicsData.map(async (t) => {
          const { count } = await supabase
            .from("articles")
            .select("id", { count: "exact", head: true })
            .eq("topic_id", t.id)
            .gte("created_at", weekAgo);
          return { ...t, articlesLast7d: count ?? 0 };
        })
      );
      return enriched;
    },
    refetchInterval: 30000,
  });

  const triggerFetch = async (topicId?: string) => {
    if (topicId) setTriggeringTopic(topicId);
    else setTriggeringAll(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      await fetch(`https://${projectId}.supabase.co/functions/v1/fetch-articles`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(topicId ? { topic_id: topicId } : {}),
      });

      queryClient.invalidateQueries({ queryKey: ["pipeline-health"] });
      queryClient.invalidateQueries({ queryKey: ["ingestion-runs"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-topics-admin"] });
    } catch (err) {
      console.error("Trigger fetch failed:", err);
    } finally {
      setTriggeringAll(false);
      setTriggeringTopic(null);
    }
  };

  const triggerBackfill = async () => {
    if (!backfillTopicId) return;
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/backfill-articles`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topic_id: backfillTopicId, days_back: backfillDays }),
      });
      const data = await res.json();
      setBackfillResult(data);
      queryClient.invalidateQueries({ queryKey: ["pipeline-health"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-topics-admin"] });
    } catch (err) {
      console.error("Backfill failed:", err);
      setBackfillResult({ error: "Backfill request failed" });
    } finally {
      setBackfilling(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "success": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case "failed": return "bg-red-500/20 text-red-400 border-red-500/30";
      case "partial": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "running": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Ingestion Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor and control the article ingestion system</p>
        </div>
        <Button onClick={() => triggerFetch()} disabled={triggeringAll} size="sm">
          {triggeringAll ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
          Run All Now
        </Button>
      </div>

      {/* Section 1: Health metrics */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <FileText className="w-3.5 h-3.5" />
              <span className="text-xs">Total Articles</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">{health?.totalArticles ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="w-3.5 h-3.5" />
              <span className="text-xs">Last 24h</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">{health?.last24h ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="w-3.5 h-3.5" />
              <span className="text-xs">Last Success</span>
            </div>
            <p className="text-sm font-medium text-foreground">
              {health?.lastSuccess ? formatDistanceToNow(new Date(health.lastSuccess), { addSuffix: true }) : "Never"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Radio className="w-3.5 h-3.5" />
              <span className="text-xs">Active Topics</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">{health?.activeTopics ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="text-xs">Failed (24h)</span>
            </div>
            <p className={`text-2xl font-semibold ${(health?.failedRuns24h ?? 0) > 0 ? "text-red-400" : "text-foreground"}`}>
              {health?.failedRuns24h ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <FileText className="w-3.5 h-3.5" />
              <span className="text-xs">RSS Feeds</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">{health?.rssFeeds ?? "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Section 2: Run log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ingestion Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Fetched</TableHead>
                <TableHead className="text-right">Inserted</TableHead>
                <TableHead className="text-right">Dupes</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runs ?? []).map((run: any) => {
                const duration = run.completed_at && run.started_at
                  ? `${differenceInSeconds(new Date(run.completed_at), new Date(run.started_at))}s`
                  : "—";
                return (
                  <TableRow key={run.id}>
                    <TableCell className="text-sm">{run.monitored_topics?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{run.source}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs border ${statusColor(run.status)}`}>
                        {run.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm">{run.articles_fetched}</TableCell>
                    <TableCell className="text-right text-sm">{run.articles_inserted}</TableCell>
                    <TableCell className="text-right text-sm">{run.articles_duplicate}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.started_at ? format(new Date(run.started_at), "MMM d HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{duration}</TableCell>
                    <TableCell className="text-xs text-red-400 max-w-[200px] truncate" title={run.error_message ?? ""}>
                      {run.error_message ?? ""}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!runs || runs.length === 0) && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No ingestion runs yet. Create a topic and hit "Run All Now".
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Section 3: Per-topic breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monitored Topics</CardTitle>
        </CardHeader>
        <CardContent>
          {(!topics || topics.length === 0) ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No monitored topics. Add topics from the Topics management page.
            </p>
          ) : (
            <div className="space-y-3">
              {topics.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Tag className="w-3.5 h-3.5 text-primary" />
                      <span className="font-medium text-sm text-foreground">{t.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {(t.keywords ?? []).map((k: string) => (
                        <span key={k} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{k}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{t.articlesLast7d} articles (7d)</span>
                      {t.last_fetched_at && (
                        <span>Last fetched {formatDistanceToNow(new Date(t.last_fetched_at), { addSuffix: true })}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerFetch(t.id)}
                    disabled={triggeringTopic === t.id}
                  >
                    {triggeringTopic === t.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 4: Historical Backfill */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4" />
            Historical Backfill
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Search archives up to 6 months back using Guardian, GDELT, and Perigon APIs. Best for filling gaps from major outlets.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Topic</label>
              <Select value={backfillTopicId} onValueChange={setBackfillTopicId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select a topic…" />
                </SelectTrigger>
                <SelectContent>
                  {(topics ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Search {backfillDays} days back</label>
              <Slider
                value={[backfillDays]}
                onValueChange={([v]) => setBackfillDays(v)}
                min={1}
                max={180}
                step={1}
                className="py-2"
              />
            </div>
            <Button
              onClick={triggerBackfill}
              disabled={backfilling || !backfillTopicId}
              size="sm"
            >
              {backfilling ? (
                <><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Searching archives…</>
              ) : (
                <><Search className="w-4 h-4 mr-2" /> Run Deep Search</>
              )}
            </Button>
          </div>
          {backfilling && (
            <div className="space-y-1">
              <Progress value={undefined} className="h-1.5" />
              <p className="text-xs text-muted-foreground text-center">Searching Guardian, GDELT & Perigon archives…</p>
            </div>
          )}
          {backfillResult && !backfillResult.error && (
            <div className="p-3 rounded-lg border border-border bg-card space-y-1">
              <p className="text-sm font-medium text-foreground">
                ✓ Found {backfillResult.inserted} new articles for "{backfillResult.topic}"
              </p>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Guardian: {backfillResult.guardian}</span>
                <span>GDELT: {backfillResult.gdelt}</span>
                <span>Perigon: {backfillResult.perigon}</span>
                <span className="text-foreground font-medium">Total inserted: {backfillResult.inserted}</span>
              </div>
            </div>
          )}
          {backfillResult?.error && (
            <p className="text-xs text-destructive">{backfillResult.error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
