import { useCallback, useEffect, useMemo, useState } from "react";

import { casesService } from "@/services/cases.service";
import type { CaseWithClient } from "@/types/models";

export interface AdminStats {
  totalOpen: number;
  pendingVerification: number;
  missingRequirements: number;
  dailyCompleted: number;
}

interface AdminCasesState {
  cases: CaseWithClient[];
  stats: AdminStats;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Loads all cases (admin) and derives the dashboard metrics from live data. */
export function useAdminCases(): AdminCasesState {
  const [cases, setCases] = useState<CaseWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCases(await casesService.listAll());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo<AdminStats>(
    () => ({
      totalOpen: cases.filter((c) => c.status !== "done").length,
      pendingVerification: cases.filter((c) => c.status === "pending").length,
      missingRequirements: cases.filter((c) => c.status === "waiting").length,
      dailyCompleted: cases.filter(
        (c) => c.status === "done" && isToday(c.updated_at),
      ).length,
    }),
    [cases],
  );

  return { cases, stats, loading, error, reload: load };
}
