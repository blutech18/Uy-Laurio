import { useCallback, useEffect, useId, useState } from "react";

import { useAuth } from "@/context/AuthContext";
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
    setLoading(true);
    setError(null);
    try {
      setNotifications(await notificationsService.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      subscribeToTables(`notifications:${channelId}`, ["notifications"], () => {
        void load();
      }),
    [channelId, load],
  );

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
  const unreadCount =
    role === "admin"
      ? notifications.filter((n) => n.delivery_status === "queued" || n.delivery_status === "failed")
          .length
      : notifications.filter((n) => !n.read_at).length;

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
