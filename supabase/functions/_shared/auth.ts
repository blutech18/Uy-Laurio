import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Service-role client: bypasses RLS. Never expose this key to the browser. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Caller {
  kind: "service" | "cron" | "admin";
  userId?: string;
  email?: string;
}

/**
 * Accepts three kinds of caller:
 *   1. the service role key (server-to-server / scheduled),
 *   2. a matching x-cron-secret header (scheduler without the service key),
 *   3. a signed-in user whose profile role is 'admin'.
 * Anything else is rejected.
 */
export async function authorize(req: Request): Promise<Caller | null> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) {
    return { kind: "cron" };
  }

  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return null;

  if (bearer === SERVICE_ROLE_KEY) return { kind: "service" };

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_active, email")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin" || !profile.is_active) return null;

  return { kind: "admin", userId: data.user.id, email: profile.email ?? undefined };
}
