import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "./supabase";

/**
 * Who is signed in right now.
 *
 * "Active" on the client register only ever meant "account not deactivated", so
 * every client looked active no matter how long ago they left. Real online
 * state comes from Supabase Realtime Presence: every signed-in tab joins one
 * shared channel keyed by user id, and a tab that closes (or loses its
 * connection) drops off automatically.
 */

const CHANNEL = "portal-presence";

let channel: RealtimeChannel | null = null;
let joinedAs: string | null = null;
let online = new Set<string>();
const listeners = new Set<(ids: Set<string>) => void>();

function emit() {
  online = new Set(Object.keys(channel?.presenceState() ?? {}));
  for (const listener of listeners) listener(online);
}

/** Joins the presence channel as `userId`. Safe to call repeatedly. */
export function joinPresence(userId: string): void {
  if (channel && joinedAs === userId) return;
  leavePresence();

  joinedAs = userId;
  channel = supabase.channel(CHANNEL, { config: { presence: { key: userId } } });
  channel
    .on("presence", { event: "sync" }, emit)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel?.track({ online_at: new Date().toISOString() });
      }
    });
}

export function leavePresence(): void {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  joinedAs = null;
  online = new Set();
  for (const listener of listeners) listener(online);
}

/** Subscribes to the set of online user ids; returns an unsubscribe function. */
export function subscribePresence(listener: (ids: Set<string>) => void): () => void {
  listeners.add(listener);
  listener(online);
  return () => {
    listeners.delete(listener);
  };
}
