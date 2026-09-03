import { useMemo, useState } from "react";
import {
  ArrowLeft, Bell, Calendar, CheckCheck, CheckCircle, FileText, Mail,
  MoreVertical, Smartphone, Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/format";
import type { NotificationKind, NotificationRecord } from "@/types/models";

/**
 * A single message as the client should experience it.
 *
 * The same announcement is queued once per delivery channel (email and SMS), so
 * the raw feed shows every message twice — the client reported this as
 * "notifications say the same thing over and over". Rows that carry identical
 * text for the same case are collapsed into one entry here, keeping the ids of
 * every underlying row so read/delete actions apply to all of them.
 */
interface FeedItem {
  key: string;
  ids: string[];
  message: string;
  kind: NotificationKind;
  caseId: string | null;
  createdAt: string;
  channels: ("email" | "sms")[];
  unread: boolean;
}

/** Short heading per notification type, so the list scans like a mail inbox. */
const KIND_TITLE: Record<NotificationKind, string> = {
  manual: "Message from the office",
  case_created: "Case created",
  status_update: "Case status updated",
  phase_update: "Case progress updated",
  requirement_request: "Documents requested",
  document_verified: "Document approved",
  document_rejected: "Document needs attention",
  case_completed: "Case completed",
  case_cancelled: "Case cancelled",
  appointment_reminder: "Appointment reminder",
  appointment_booked: "Appointment confirmed",
  announcement: "Announcement",
};

function kindIcon(kind: NotificationKind) {
  if (kind === "appointment_booked" || kind === "appointment_reminder") {
    return <Calendar size={15} />;
  }
  if (kind === "document_verified" || kind === "case_completed") {
    return <CheckCircle size={15} />;
  }
  if (kind === "requirement_request" || kind === "document_rejected") {
    return <FileText size={15} />;
  }
  return <Bell size={15} />;
}

function groupNotifications(rows: NotificationRecord[]): FeedItem[] {
  const groups = new Map<string, FeedItem>();

  for (const row of rows) {
    // Same text, same case, same minute = one message fanned out per channel.
    const minute = row.created_at.slice(0, 16);
    const key = `${row.case_id ?? "none"}|${row.kind}|${minute}|${row.message}`;
    const existing = groups.get(key);

    if (existing) {
      existing.ids.push(row.id);
      if (!existing.channels.includes(row.channel)) existing.channels.push(row.channel);
      // Unread until every copy has been read.
      existing.unread = existing.unread || !row.read_at;
      continue;
    }

    groups.set(key, {
      key,
      ids: [row.id],
      message: row.message,
      kind: row.kind,
      caseId: row.case_id,
      createdAt: row.created_at,
      channels: [row.channel],
      unread: !row.read_at,
    });
  }

  return [...groups.values()];
}

export function NotificationsPanel({
  notifications,
  loading,
  onMarkRead,
  onMarkAllRead,
  onRemove,
}: {
  notifications: NotificationRecord[];
  loading: boolean;
  onMarkRead: (id: string) => Promise<void> | void;
  onMarkAllRead: () => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
}) {
  const items = useMemo(() => groupNotifications(notifications), [notifications]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const selected = items.find((i) => i.key === openKey) ?? null;
  const unreadTotal = items.filter((i) => i.unread).length;

  const markRead = async (item: FeedItem) => {
    await Promise.all(item.ids.map((id) => onMarkRead(id)));
  };

  const removeItem = async (item: FeedItem) => {
    if (openKey === item.key) setOpenKey(null);
    await Promise.all(item.ids.map((id) => onRemove(id)));
  };

  /** Opening a message is the read receipt, as in any mail client. */
  const openItem = (item: FeedItem) => {
    setOpenKey(item.key);
    if (item.unread) void markRead(item);
  };

  // ── Detail view: the "second page" for one message ───────────────────────
  if (selected) {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="px-4 sm:px-5 py-4 border-b border-black/8 flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setOpenKey(null)}
            aria-label="Back to all notifications"
            className="w-8 h-8 rounded-full hover:bg-black/5 flex items-center justify-center text-[#344248] transition-colors">
            <ArrowLeft size={17} />
          </button>
          <p className="text-xs font-semibold text-[#6b6b6b] uppercase tracking-wider">
            Notification
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-6">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-[#8A1C1F]/10 text-[#8A1C1F] flex items-center justify-center shrink-0">
              {kindIcon(selected.kind)}
            </div>
            <div className="min-w-0">
              <h3 style={{ fontFamily: "'Cinzel',serif" }} className="text-base font-bold text-[#1E1E1E] leading-snug">
                {KIND_TITLE[selected.kind] ?? "Notification"}
              </h3>
              <p className="text-[11px] text-[#A0A0A0] mt-1">
                {formatDateTime(selected.createdAt)}
              </p>
            </div>
          </div>

          <p className="text-sm text-[#1E1E1E] leading-relaxed whitespace-pre-line">
            {selected.message}
          </p>

          <div className="mt-7 pt-5 border-t border-black/8 space-y-2">
            <p className="text-[10px] font-semibold text-[#A0A0A0] uppercase tracking-wider">
              Sent to you by
            </p>
            <div className="flex items-center gap-2">
              {selected.channels.map((c) => (
                <span key={c}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#344248] bg-[#F4F5F7] border border-black/8 rounded-full px-2.5 py-1">
                  {c === "email" ? <Mail size={11} /> : <Smartphone size={11} />}
                  {c === "email" ? "Email" : "SMS"}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#344248] bg-[#F4F5F7] border border-black/8 rounded-full px-2.5 py-1">
                <Bell size={11} /> Portal
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void removeItem(selected)}
            className="mt-7 inline-flex items-center gap-2 text-xs font-semibold text-[#DC2626] hover:underline">
            <Trash2 size={13} /> Delete this notification
          </button>
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {items.length > 0 && (
        <div className="px-5 py-2.5 bg-white border-b border-black/5 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[#6b6b6b]">
            {unreadTotal > 0 ? `${unreadTotal} unread` : "All caught up"}
          </span>
          {unreadTotal > 0 && (
            <button
              type="button"
              onClick={() => void onMarkAllRead()}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#8A1C1F] hover:underline">
              <CheckCheck size={13} /> Mark all as read
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center text-sm text-[#6b6b6b]">Loading notifications…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center">
            <Bell size={26} className="mx-auto text-[#A0A0A0] mb-3" />
            <p className="text-sm text-[#6b6b6b]">No notifications yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-black/5 bg-white">
            {items.map((item) => (
              <div
                key={item.key}
                className={`flex items-start gap-3 transition-colors ${
                  item.unread ? "bg-[#8A1C1F]/[0.035]" : "bg-white"
                } hover:bg-[#FDFDFD]`}>
                {/* Tapping the row opens the message */}
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className="flex-1 min-w-0 text-left px-5 py-4 flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    item.unread
                      ? "bg-[#8A1C1F]/12 text-[#8A1C1F]"
                      : "bg-[#F4F5F7] text-[#A0A0A0]"
                  }`}>
                    {kindIcon(item.kind)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-[11px] uppercase tracking-wider truncate ${
                        item.unread ? "font-bold text-[#8A1C1F]" : "font-semibold text-[#A0A0A0]"
                      }`}>
                        {KIND_TITLE[item.kind] ?? "Notification"}
                      </p>
                      {item.unread && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#8A1C1F] shrink-0" aria-label="Unread" />
                      )}
                    </div>
                    {/* Unread messages read bold, and lose the weight once opened */}
                    <p className={`text-sm leading-snug mt-1 line-clamp-2 ${
                      item.unread ? "font-semibold text-[#1E1E1E]" : "font-normal text-[#6b6b6b]"
                    }`}>
                      {item.message}
                    </p>
                    <p className="text-[10px] text-[#A0A0A0] mt-1.5">
                      {formatDateTime(item.createdAt)}
                    </p>
                  </div>
                </button>

                {/* Per-notification actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Notification options"
                      className="mt-4 mr-3 w-8 h-8 rounded-full hover:bg-black/5 flex items-center justify-center text-[#A0A0A0] hover:text-[#1E1E1E] transition-colors shrink-0">
                      <MoreVertical size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  {/* z-index sits above the notification sheet (z-50) so the
                      menu is not clipped behind it. */}
                  <DropdownMenuContent align="end" className="w-44 z-[60]">
                    {item.unread && (
                      <DropdownMenuItem onClick={() => void markRead(item)}>
                        <CheckCircle size={14} /> Mark as read
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => void removeItem(item)}>
                      <Trash2 size={14} /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
