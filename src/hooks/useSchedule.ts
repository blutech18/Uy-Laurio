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
  /**
   * Live bookings across every client, keyed by YYYY-MM-DD.
   *
   * `appointments` is narrowed by RLS to the caller's own rows, so it cannot
   * answer "is this slot free?" for a client. This map comes from the
   * `booked_slots` function and carries slot labels only.
   */
  bookedSlots: Record<string, string[]>;
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
  const [bookedSlots, setBookedSlots] = useState<Record<string, string[]>>({});
  const [officeHours, setOfficeHours] = useState<OfficeHours[]>([]);
  const [timeSlots, setTimeSlots] = useState<OfficeTimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Occupancy is fetched for a window around today, wide enough to cover the
    // months the calendar lets you page through.
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 12, 0);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    try {
      const [ov, appts, hours, slots, booked] = await Promise.all([
        scheduleService.listOverrides(),
        scheduleService.listAppointments(),
        scheduleService.listOfficeHours(),
        scheduleService.listTimeSlots(),
        scheduleService.listBookedSlots(iso(from), iso(to)),
      ]);
      setOverrideList(ov);
      setAppointments(appts);
      setOfficeHours(hours);
      setTimeSlots(slots);
      setBookedSlots(booked);
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
    bookedSlots,
    officeHours,
    timeSlots,
    fullSlots,
    halfSlots,
    loading,
    error,
    reload: load,
  };
}
