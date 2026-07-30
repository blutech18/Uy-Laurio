import { supabase } from "@/lib/supabase";
import type {
  ActivityEntry,
  DbCaseStatus,
  NotificationLogRow,
  ServiceModule,
  ServiceSummaryRow,
  TransactionLogRow,
} from "@/types/models";

export interface DateRange {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

/**
 * Report queries. Each one is a security-definer RPC that checks
 * `public.is_admin()` first, so reports cannot be pulled by a client account.
 */
export const reportsService = {
  async serviceSummary(range: DateRange = {}): Promise<ServiceSummaryRow[]> {
    const { data, error } = await supabase.rpc("report_service_summary", {
      p_from: range.from ?? null,
      p_to: range.to ?? null,
    });
    if (error) throw error;
    return (data ?? []) as ServiceSummaryRow[];
  },

  async transactionLog(
    range: DateRange = {},
    filters: { module?: ServiceModule; status?: DbCaseStatus } = {},
  ): Promise<TransactionLogRow[]> {
    const { data, error } = await supabase.rpc("report_transaction_log", {
      p_from: range.from ?? null,
      p_to: range.to ?? null,
      p_module: filters.module ?? null,
      p_status: filters.status ?? null,
    });
    if (error) throw error;
    return (data ?? []) as TransactionLogRow[];
  },

  async activityLog(
    range: DateRange = {},
    options: { action?: string; limit?: number } = {},
  ): Promise<ActivityEntry[]> {
    const { data, error } = await supabase.rpc("report_activity_log", {
      p_from: range.from ?? null,
      p_to: range.to ?? null,
      p_action: options.action ?? null,
      p_limit: options.limit ?? 500,
    });
    if (error) throw error;
    return (data ?? []) as ActivityEntry[];
  },

  async notificationLog(range: DateRange = {}): Promise<NotificationLogRow[]> {
    const { data, error } = await supabase.rpc("report_notification_log", {
      p_from: range.from ?? null,
      p_to: range.to ?? null,
    });
    if (error) throw error;
    return (data ?? []) as NotificationLogRow[];
  },

  /** Turns any report result set into CSV text. */
  toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0]);
    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return "";
      const text = typeof value === "object" ? JSON.stringify(value) : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
      headers.join(","),
      ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
    ].join("\r\n");
  },

  /** Triggers a browser download of a generated CSV report. */
  download(filename: string, rows: Record<string, unknown>[]): void {
    const csv = this.toCsv(rows);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
};
