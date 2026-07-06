import { supabase } from "@/lib/supabase";
import type { NotificationChannel, NotificationRecord } from "@/types/models";

export interface CreateNotificationInput {
  caseId: string | null;
  recipient: string;
  channel: NotificationChannel;
  message: string;
  createdBy: string;
}

export const notificationsService = {
  /** RLS returns the caller's own notifications, or all of them for admins. */
  async list(limit = 50): Promise<NotificationRecord[]> {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  async create({
    caseId,
    recipient,
    channel,
    message,
    createdBy,
  }: CreateNotificationInput): Promise<NotificationRecord> {
    const { data, error } = await supabase
      .from("notifications")
      .insert({
        case_id: caseId,
        recipient,
        channel,
        message,
        created_by: createdBy,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
