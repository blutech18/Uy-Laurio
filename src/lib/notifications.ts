import type { NotificationKind, NotificationRecord } from "@/types/models";

/**
 * A single message as the user should experience it.
 *
 * The same announcement is queued once per delivery channel (email and SMS), so
 * the raw feed shows every message twice — the client reported this as
 * "notifications say the same thing over and over". Rows that carry identical
 * text for the same case are collapsed into one entry, keeping the ids of every
 * underlying row so read/delete actions apply to all of them.
 *
 * Shared between the panel (which renders the feed) and `useNotifications`
 * (which computes the bell badge) so the two can never disagree again: the
 * badge previously counted raw rows while the panel counted groups, which made
 * the number on the bell exactly double what the panel showed.
 */
export interface FeedItem {
  key: string;
  ids: string[];
  message: string;
  kind: NotificationKind;
  caseId: string | null;
  createdAt: string;
  channels: ("email" | "sms")[];
  unread: boolean;
}

export function groupNotifications(rows: NotificationRecord[]): FeedItem[] {
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
