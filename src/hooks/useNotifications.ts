import { useCallback, useEffect, useState } from "react";

import { notificationsService } from "@/services/notifications.service";
import type { NotificationRecord } from "@/types/models";

interface NotificationsState {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useNotifications(): NotificationsState {
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

  return {
    notifications,
    unreadCount: notifications.filter((n) => n.status === "pending").length,
    loading,
    error,
    reload: load,
  };
}
