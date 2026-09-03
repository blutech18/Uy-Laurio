import { supabase } from "@/lib/supabase";
import type {
  NotificationChannel,
  NotificationKind,
  NotificationRecord,
} from "@/types/models";

export interface CreateNotificationInput {
  caseId: string | null;
  recipient: string;
  channel: NotificationChannel;
  message: string;
  createdBy: string;
  /** Defaults to a staff-written message. */
  kind?: NotificationKind;
  /** Recipient profile id, so office-wide messages are still visible in-app. */
  recipientId?: string | null;
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
    return (data ?? []) as NotificationRecord[];
  },

  async create({
    caseId,
    recipient,
    channel,
    message,
    createdBy,
    kind = "manual",
    recipientId,
  }: CreateNotificationInput): Promise<NotificationRecord> {
    let resolvedRecipientId = recipientId ?? null;

    // Fall back to the case owner so the message also appears in their portal.
    if (!resolvedRecipientId && caseId) {
      const { data: row } = await supabase
        .from("cases")
        .select("client_id")
        .eq("id", caseId)
        .maybeSingle();
      resolvedRecipientId = row?.client_id ?? null;
    }

    const { data, error } = await supabase
      .from("notifications")
      .insert({
        case_id: caseId,
        recipient,
        recipient_id: resolvedRecipientId,
        channel,
        message,
        kind,
        created_by: createdBy,
      })
      .select("*")
      .single();
    if (error) throw error;

    // Hand the queue to the delivery function; a failure here is not fatal
    // because the row stays queued for the next sweep.
    void notificationsService.dispatch(data.id);

    return data as NotificationRecord;
  },

  /**
   * Asks the `send-notification` Edge Function to deliver queued rows. Pass an
   * id to deliver one immediately, or nothing to drain the queue.
   */
  async dispatch(id?: string): Promise<void> {
    try {
      await supabase.functions.invoke("send-notification", {
        body: id ? { id } : {},
      });
    } catch {
      /* delivery is retried by the scheduled sweep */
    }
  },

  async markRead(id: string): Promise<void> {
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);
    if (error) throw error;
  },

  /**
   * Marks every notification the caller can see as read.
   *
   * This delegates to `mark_my_notifications_read` (migration 0012) rather than
   * filtering on `recipient_id` here. Automated notifications are attached to a
   * case and may carry no `recipient_id`, so a client-side filter on that column
   * silently skipped them — they stayed unread forever and the bell badge never
   * cleared.
   */
  async markAllRead(): Promise<number> {
    const { data, error } = await supabase.rpc("mark_my_notifications_read");
    if (error) throw error;
    return typeof data === "number" ? data : 0;
  },

  /** Removes the recipient's copy of a notification. */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("notifications").delete().eq("id", id);
    if (error) throw error;
  },
};
