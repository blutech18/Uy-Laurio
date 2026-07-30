import { supabase } from "@/lib/supabase";
import type { ClientSummary, DashboardStats, Profile } from "@/types/models";

export interface ClientFilters {
  search?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
}

export interface PagedClients {
  rows: ClientSummary[];
  total: number;
}

export interface CreateClientInput {
  email: string;
  fullName: string;
  phone?: string | null;
  notes?: string | null;
  /** Omit to email the client a set-password link instead. */
  password?: string;
}

/**
 * Staff-side operations. Everything here is gated by `public.is_admin()` in the
 * database (RPC guards + RLS), so a non-admin caller gets an error rather than
 * data. Account creation needs the service role and therefore runs in the
 * `admin-create-client` Edge Function.
 */
export const adminService = {
  async dashboardStats(): Promise<DashboardStats> {
    const { data, error } = await supabase.rpc("admin_dashboard_stats");
    if (error) throw error;
    return data as DashboardStats;
  },

  async listClients(filters: ClientFilters = {}): Promise<PagedClients> {
    const { data, error } = await supabase.rpc("admin_list_clients", {
      p_search: filters.search ?? null,
      p_active: filters.active ?? null,
      p_limit: filters.limit ?? 50,
      p_offset: filters.offset ?? 0,
    });
    if (error) throw error;

    const rows = (data ?? []) as (ClientSummary & { total_count: number })[];
    return {
      total: rows[0]?.total_count ?? 0,
      rows: rows.map(({ total_count: _total, ...row }) => ({
        ...row,
        case_count: Number(row.case_count ?? 0),
        open_cases: Number(row.open_cases ?? 0),
      })),
    };
  },

  /** Staff members available for case assignment. */
  async listStaff(): Promise<Pick<Profile, "id" | "full_name" | "email">[]> {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "admin")
      .eq("is_active", true)
      .order("full_name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async createClient(input: CreateClientInput): Promise<{ profile: Profile; inviteSent: boolean }> {
    const { data, error } = await supabase.functions.invoke("admin-create-client", {
      body: {
        email: input.email,
        fullName: input.fullName,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        password: input.password,
      },
    });

    if (error) {
      // Edge Function errors carry the useful message in the response body.
      const detail = await readFunctionError(error);
      throw new Error(detail ?? error.message);
    }
    return data as { profile: Profile; inviteSent: boolean };
  },

  async updateClient(
    clientId: string,
    patch: Partial<Pick<Profile, "full_name" | "phone" | "notes">>,
  ): Promise<void> {
    const { error } = await supabase.from("profiles").update(patch).eq("id", clientId);
    if (error) throw error;
  },

  /** Deactivated accounts stay on record but lose access to portal data. */
  async setActive(clientId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: isActive })
      .eq("id", clientId);
    if (error) throw error;
  },
};

async function readFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    const body = await context.json().catch(() => null);
    if (body && typeof body.error === "string") return body.error;
  }
  return null;
}
