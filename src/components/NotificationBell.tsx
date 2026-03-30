import { useState, useEffect, useRef } from "react";
import { Bell, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";

interface AppNotification {
  id: string;
  title: string;
  body: string;
  kind: string;
  read_at: string | null;
  created_at: string;
  payload: Record<string, any>;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const channelNameRef = useRef(`app_notifications_bell-${crypto.randomUUID()}`);

  const unreadCount = notifications.filter(n => !n.read_at).length;

  // Fetch notifications
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("app_notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setNotifications(data as AppNotification[]);
    };
    load();

    // Realtime subscription
    const channel = supabase
      .channel(channelNameRef.current)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "app_notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications(prev => [payload.new as AppNotification, ...prev].slice(0, 20));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const markAllRead = async () => {
    if (!user) return;
    const unread = notifications.filter(n => !n.read_at);
    if (unread.length === 0) return;
    const now = new Date().toISOString();
    await supabase
      .from("app_notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || now })));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-xl hover:bg-bg-elevated transition"
      >
        <Bell className="w-4.5 h-4.5 text-text-secondary" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-medium flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 max-h-96 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-medium text-foreground">Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Check className="w-3 h-3" /> Mark all read
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">No notifications yet</div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 border-b border-border/50 last:border-0 ${!n.read_at ? "bg-primary/5" : ""}`}
                  >
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
