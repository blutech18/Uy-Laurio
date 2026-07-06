import { supabase } from "@/lib/supabase";
import type {
  Appointment,
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

  async listAppointments(): Promise<Appointment[]> {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .order("appointment_date", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async book({
    clientId,
    date,
    timeSlot,
  }: BookAppointmentInput): Promise<Appointment> {
    const { data, error } = await supabase
      .from("appointments")
      .insert({ client_id: clientId, appointment_date: date, time_slot: timeSlot })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
