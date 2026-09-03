import { supabase } from "@/lib/supabase";
import type {
  Appointment,
  OfficeHours,
  OfficeTimeSlot,
  OverrideType,
  ScheduleOverride,
} from "@/types/models";

export interface ApplyOverrideInput {
  date: string; // YYYY-MM-DD
  type: OverrideType;
  openTime?: string | null;
  closeTime?: string | null;
  createdBy: string;
}

export interface BookAppointmentInput {
  clientId: string;
  date: string; // YYYY-MM-DD
  timeSlot: string;
  caseId?: string | null;
  purpose?: string | null;
}

export const scheduleService = {
  async listOverrides(): Promise<ScheduleOverride[]> {
    const { data, error } = await supabase
      .from("schedule_overrides")
      .select("*")
      .order("override_date", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async applyOverride({
    date,
    type,
    openTime,
    closeTime,
    createdBy,
  }: ApplyOverrideInput): Promise<ScheduleOverride> {
    const { data, error } = await supabase
      .from("schedule_overrides")
      .upsert(
        {
          override_date: date,
          type,
          open_time: openTime ?? null,
          close_time: closeTime ?? null,
          created_by: createdBy,
        },
        { onConflict: "override_date" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeOverride(date: string): Promise<void> {
    const { error } = await supabase
      .from("schedule_overrides")
      .delete()
      .eq("override_date", date);
    if (error) throw error;
  },

  /** Weekly opening hours (0 = Sunday), editable by administrators. */
  async listOfficeHours(): Promise<OfficeHours[]> {
    const { data, error } = await supabase
      .from("office_hours")
      .select("*")
      .order("day_of_week", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async updateOfficeHours(
    dayOfWeek: number,
    patch: Partial<Pick<OfficeHours, "is_open" | "open_time" | "close_time">>,
  ): Promise<void> {
    const { error } = await supabase
      .from("office_hours")
      .update(patch)
      .eq("day_of_week", dayOfWeek);
    if (error) throw error;
  },

  /** Bookable slot labels, in the exact format the calendar renders. */
  async listTimeSlots(): Promise<OfficeTimeSlot[]> {
    const { data, error } = await supabase
      .from("office_time_slots")
      .select("*")
      .eq("active", true)
      .order("ordinal", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async listAppointments(): Promise<Appointment[]> {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .order("appointment_date", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Slot occupancy across every client, for the booking calendar.
   *
   * `listAppointments` is filtered by RLS to the caller's own bookings, so a
   * client could not tell whether a slot was already taken. This reads the
   * `booked_slots` function (migration 0013), which returns date/slot pairs only
   * — enough to mark a day full without revealing who booked it.
   */
  async listBookedSlots(from: string, to: string): Promise<Record<string, string[]>> {
    const { data, error } = await supabase.rpc("booked_slots", {
      p_from: from,
      p_to: to,
    });
    if (error) throw error;

    const map: Record<string, string[]> = {};
    for (const row of (data ?? []) as { appointment_date: string; time_slot: string }[]) {
      (map[row.appointment_date] ??= []).push(row.time_slot);
    }
    return map;
  },

  async listUpcoming(limit = 10): Promise<Appointment[]> {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;

    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("status", "booked")
      .gte("appointment_date", iso)
      .order("appointment_date", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  async book({
    clientId,
    date,
    timeSlot,
    caseId,
    purpose,
  }: BookAppointmentInput): Promise<Appointment> {
    const { data, error } = await supabase
      .from("appointments")
      .insert({
        client_id: clientId,
        appointment_date: date,
        time_slot: timeSlot,
        case_id: caseId ?? null,
        purpose: purpose ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async cancel(appointmentId: string, reason?: string): Promise<void> {
    const { error } = await supabase
      .from("appointments")
      .update({ status: "cancelled", cancelled_reason: reason ?? null })
      .eq("id", appointmentId);
    if (error) throw error;
  },

  async reschedule(appointmentId: string, date: string, timeSlot: string): Promise<void> {
    const { error } = await supabase
      .from("appointments")
      .update({ appointment_date: date, time_slot: timeSlot })
      .eq("id", appointmentId);
    if (error) throw error;
  },

  async complete(appointmentId: string): Promise<void> {
    const { error } = await supabase
      .from("appointments")
      .update({ status: "completed" })
      .eq("id", appointmentId);
    if (error) throw error;
  },
};
