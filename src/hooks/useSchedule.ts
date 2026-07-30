import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { subscribeToTables } from "@/lib/realtime";
import { scheduleService } from "@/services/schedule.service";
import type {
  Appointment,
  OfficeHours,
  OfficeTimeSlot,
  ScheduleOverride,
} from "@/types/models";

interface ScheduleState {
  overrides: Record<string, ScheduleOverride>; // keyed by YYYY-MM-DD
  appointments: Appointment[];
  officeHours: OfficeHours[];
  timeSlots: OfficeTimeSlot[];
  /** Slot labels for a normal day and for half-day operations. */
  fullSlots: string[];
  halfSlots: string[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Office availability: date overrides, weekly hours, bookable slots and live
 * bookings. Hours and slots come from the database so staff can change them
 * without a code deploy.
 */
export function useSchedule(): ScheduleState {
  const channelId = useId();

  const [overrideList, setOverrideList] = useState<ScheduleOverride[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [officeHours, setOfficeHours] = useState<OfficeHours[]>([]);
  const [timeSlots, setTimeSlots] = useState<OfficeTimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, appts, hours, slots] = await Promise.all([
        scheduleService.listOverrides(),
        scheduleService.listAppointments(),
        scheduleService.listOfficeHours(),
        scheduleService.listTimeSlots(),
      ]);
      setOverrideList(ov);
      setAppointments(appts);
      setOfficeHours(hours);
      setTimeSlots(slots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the schedule.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      subscribeToTables(
        `schedule:${channelId}`,
        ["appointments", "schedule_overrides"],
        () => {
          void load();
        },
      ),
    [channelId, load],
  );

  const overrides = useMemo(
    () =>
      Object.fromEntries(overrideList.map((o) => [o.override_date, o])) as Record<
        string,
        ScheduleOverride
      >,
    [overrideList],
  );

  const fullSlots = useMemo(() => timeSlots.map((s) => s.slot_label), [timeSlots]);
  const halfSlots = useMemo(
    () => timeSlots.filter((s) => s.halfday).map((s) => s.slot_label),
    [timeSlots],
  );

  return {
    overrides,
    appointments,
    officeHours,
    timeSlots,
    fullSlots,
    halfSlots,
    loading,
    error,
    reload: load,
  };
}
