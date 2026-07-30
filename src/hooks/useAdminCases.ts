import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { subscribeToTables } from "@/lib/realtime";
import { adminService } from "@/services/admin.service";
import { casesService, type CaseFilters } from "@/services/cases.service";
import type { CaseWithClient, DashboardStats } from "@/types/models";

export interface AdminStats {
  totalOpen: number;
  pendingVerification: number;
  missingRequirements: number;
  dailyCompleted: number;
  cancelled: number;
  unverifiedDocuments: number;
  upcomingAppointments: number;
  clientsTotal: number;
  notificationsQueued: number;
}

interface AdminCasesState {
  cases: CaseWithClient[];
  total: number;
  stats: AdminStats;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const EMPTY_STATS: AdminStats = {
  totalOpen: 0,
  pendingVerification: 0,
  missingRequirements: 0,
  dailyCompleted: 0,
  cancelled: 0,
  unverifiedDocuments: 0,
  upcomingAppointments: 0,
  clientsTotal: 0,
  notificationsQueued: 0,
};

function toStats(raw: DashboardStats | null): AdminStats {
  if (!raw) return EMPTY_STATS;
  return {
    totalOpen: Number(raw.total_open ?? 0),
    pendingVerification: Number(raw.pending_verification ?? 0),
    missingRequirements: Number(raw.missing_requirements ?? 0),
    dailyCompleted: Number(raw.daily_completed ?? 0),
    cancelled: Number(raw.cancelled ?? 0),
    unverifiedDocuments: Number(raw.unverified_documents ?? 0),
    upcomingAppointments: Number(raw.upcoming_appointments ?? 0),
    clientsTotal: Number(raw.clients_total ?? 0),
    notificationsQueued: Number(raw.notifications_queued ?? 0),
  };
}

/**
 * Admin case listing plus dashboard metrics.
 *
 * Both come from the database (`list_cases` and `admin_dashboard_stats`), so the
 * browser no longer downloads every case to count them, and the numbers stay
 * correct as volume grows. Live updates arrive over Realtime.
 */
export function useAdminCases(filters: CaseFilters = {}): AdminCasesState {
  const filterKey = JSON.stringify(filters);
  // Each hook instance needs its own Realtime topic.
  const channelId = useId();

  const [cases, setCases] = useState<CaseWithClient[]>([]);
  const [total, setTotal] = useState(0);
  const [rawStats, setRawStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const active = JSON.parse(filterKey) as CaseFilters;
      const [page, stats] = await Promise.all([
        casesService.list(active),
        adminService.dashboardStats(),
      ]);
      setCases(page.rows);
      setTotal(page.total);
      setRawStats(stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cases.");
    } finally {
      setLoading(false);
    }
  }, [filterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      subscribeToTables(
        `admin-cases:${channelId}`,
        ["cases", "documents", "case_requirements"],
        () => {
          void load();
        },
      ),
    [load, channelId],
  );

  const stats = useMemo(() => toStats(rawStats), [rawStats]);

  return { cases, total, stats, loading, error, reload: load };
}
