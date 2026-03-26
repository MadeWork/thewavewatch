import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const VAPID_PUBLIC_KEY = "BHnVRzaKzPz8ojWN_QSDtS9_0NeE4BIg9Ok1XW65LI3Nbp911JG2mI4e7DaYir9Pqensn39K5mGQl9ZLD28DP_I";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function usePushSubscription() {
  const { user } = useAuth();
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    const isSupported = "serviceWorker" in navigator && "PushManager" in window;
    setSupported(isSupported);
    if (isSupported) {
      setPermission(Notification.permission);
    }
  }, []);

  // Check if already subscribed
  useEffect(() => {
    if (!supported || !user) return;
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    });
  }, [supported, user]);

  // Register service worker on mount
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.register("/sw.js").catch(console.error);
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!user || !supported) return false;
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setLoading(false);
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });

      const json = sub.toJSON();
      await supabase.from("push_subscriptions").upsert({
        user_id: user.id,
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
      }, { onConflict: "user_id,endpoint" });

      setSubscribed(true);
      setLoading(false);
      return true;
    } catch (e) {
      console.error("Push subscribe error:", e);
      setLoading(false);
      return false;
    }
  }, [user, supported]);

  const unsubscribe = useCallback(async () => {
    if (!user || !supported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", user.id)
          .eq("endpoint", sub.endpoint);
      }
      setSubscribed(false);
    } catch (e) {
      console.error("Push unsubscribe error:", e);
    }
    setLoading(false);
  }, [user, supported]);

  return { supported, subscribed, loading, permission, subscribe, unsubscribe };
}
