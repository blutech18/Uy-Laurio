import { useCallback, useEffect, useMemo, useState } from "react";

import { scheduleService } from "@/services/schedule.service";
import type { Appointment, ScheduleOverride } from "@/types/models";

interface ScheduleState {
  overrides: Record<string, ScheduleOverride>; // keyed by YYYY-MM-DD
  appointments: Appointment[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useSchedule(): ScheduleState {
  const [overrideList, setOverrideList] = useState<ScheduleOverride[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, appts] = await Promise.all([
        scheduleService.listOverrides(),
        scheduleService.listAppointments(),
      ]);
      setOverrideList(ov);
      setAppointments(appts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the schedule.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const overrides = useMemo(
    () =>
      Object.fromEntries(overrideList.map((o) => [o.override_date, o])) as Record<
        string,
        ScheduleOverride
      >,
    [overrideList],
  );

  return { overrides, appointments, loading, error, reload: load };
}
