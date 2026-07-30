import { supabase } from "./supabase";

/**
 * Subscribes to Postgres change events on the given public tables and calls
 * `onChange` (debounced) whenever anything relevant moves.
 *
 * Row Level Security applies to the change feed as well, so a client only ever
 * receives events for rows they are allowed to read.
 *
 * Returns an unsubscribe function suitable for a useEffect cleanup.
 */
export function subscribeToTables(
  channelName: string,
  tables: string[],
  onChange: () => void,
  debounceMs = 250,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  const channel = supabase.channel(channelName);

  for (const table of tables) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      fire,
    );
  }

  channel.subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}
