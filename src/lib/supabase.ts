import { createClient } from "@supabase/supabase-js";

import { env } from "./env";

/**
 * Single shared Supabase client for the whole app.
 *
 * Sessions are persisted and auto-refreshed so a signed-in client stays
 * authenticated across reloads. All data access goes through this client and
 * is constrained by the Row Level Security policies defined in
 * `supabase/migrations`.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const DOCUMENTS_BUCKET = "documents";
