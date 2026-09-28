import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { groupNotifications } from "@/lib/notifications";
import { subscribeToTables } from "@/lib/realtime";
import { notificationsService } from "@/services/notifications.service";
import type { NotificationRecord } from "@/types/models";

interface NotificationsState {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * Notification feed for the signed-in user (admins see all traffic).
 *
 * `unreadCount` reflects the recipient's read state, not delivery state, so the
 * bell badge means "new for you" rather than "not yet sent".
 */
export function useNotifications(): NotificationsState {
  const { session, role } = useAuth();
  const userId = session?.user?.id ?? null;
  const channelId = useId();

  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setNotifications(await notificationsService.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, userId]);

  useEffect(() => {
    if (!userId) return;
    const cleanId = channelId.replace(/[^a-zA-Z0-9_-]/g, "");
    const unsub = subscribeToTables(`notifs-${userId.slice(0, 8)}-${cleanId}`, ["notifications"], () => {
      void load();
    });

    // Fallback polling every 20s and on window focus so clients never miss dispatched updates
    const interval = setInterval(() => {
      void load();
    }, 20000);

    const onFocus = () => {
      void load();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      unsub();
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId, channelId, load]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    try {
      await notificationsService.markRead(id);
    } catch {
      await load();
    }
  }, [load]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const stamp = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: stamp })));
    try {
      await notificationsService.markAllRead();
    } catch {
      await load();
    }
  }, [userId, load]);

  const remove = useCallback(async (id: string) => {
    const previous = notifications;
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await notificationsService.remove(id);
    } catch {
      setNotifications(previous);
    }
  }, [notifications]);

  // Clients: what is new for them. Staff: what still needs to go out.
  //
  // The client predicate deliberately matches what `markAllRead` can stamp, so
  // the badge can always reach zero. Automated notifications hang off a case and
  // may carry no `recipient_id`; those used to be counted here but skipped by
  // the update, which is why the badge never cleared.
  //
  // The count is computed over the *grouped* feed (see lib/notifications.ts):
  // one announcement fans out to one row per channel, so counting raw rows made
  // the badge double what the panel listed. Staff keep the raw count because
  // each channel copy is a real delivery that still has to go out.
  const unreadCount = useMemo(() => {
    if (role === "admin") {
      return notifications.filter(
        (n) => n.delivery_status === "queued" || n.delivery_status === "failed",
      ).length;
    }
    return groupNotifications(notifications).filter((item) => item.unread).length;
  }, [notifications, role]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    reload: load,
    markRead,
    markAllRead,
    remove,
  };
}
