import { supabase } from "@/lib/supabase";
import {
  toUiStatus,
  type Case,
  type CasePhase,
  type CaseTimelineEntry,
  type CaseWithClient,
  type DbCaseStatus,
  type ServiceModule,
  type StatusKey,
} from "@/types/models";

export interface CreateCaseInput {
  clientId: string;
  module: ServiceModule;
  moduleDetail?: string | null;
  /** Set when staff record a walk-in transaction on a client's behalf. */
  createdBy?: string | null;
}

export interface CaseFilters {
  search?: string;
  status?: DbCaseStatus;
  module?: ServiceModule;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  limit?: number;
  offset?: number;
}

export interface PagedCases {
  rows: CaseWithClient[];
  total: number;
}

/** DB row -> app model: keeps the real status and the UI-facing mapped one. */
function mapCase<T extends { status: DbCaseStatus }>(row: T): T & {
  status: StatusKey;
  db_status: DbCaseStatus;
} {
  return { ...row, status: toUiStatus(row.status), db_status: row.status };
}

interface ListCasesRow {
  id: string;
  reference: string;
  client_id: string;
  module: ServiceModule;
  module_detail: string | null;
  status: DbCaseStatus;
  phase: CasePhase;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  assignee_name: string | null;
  open_requirements: number;
  total_count: number;
}

export const casesService = {
  /** Cases belonging to the signed-in client (RLS scopes the result). */
  async listForClient(clientId: string): Promise<Case[]> {
    const { data, error } = await supabase
      .from("cases")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapCase) as Case[];
  },

  /** The client's own transaction history, including completed and cancelled. */
  async historyForClient(): Promise<Case[]> {
    const { data, error } = await supabase.rpc("client_case_history");
    if (error) throw error;
    return ((data ?? []) as { status: DbCaseStatus }[]).map(mapCase) as unknown as Case[];
  },

  /**
   * Admin listing: paginated and filtered server-side via the `list_cases` RPC
   * so the browser never downloads the whole table.
   */
  async list(filters: CaseFilters = {}): Promise<PagedCases> {
    const { data, error } = await supabase.rpc("list_cases", {
      p_search: filters.search ?? null,
      p_status: filters.status ?? null,
      p_module: filters.module ?? null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
      p_limit: filters.limit ?? 50,
      p_offset: filters.offset ?? 0,
    });
    if (error) throw error;

    const rows = (data ?? []) as ListCasesRow[];
    return {
      total: rows[0]?.total_count ?? 0,
      rows: rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        client_id: r.client_id,
        module: r.module,
        module_detail: r.module_detail,
        status: toUiStatus(r.status),
        db_status: r.status,
        phase: r.phase,
        assigned_to: r.assigned_to,
        assigned_at: null,
        cancelled_reason: null,
        completed_at: r.completed_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        assignee_name: r.assignee_name,
        open_requirements: Number(r.open_requirements ?? 0),
        client: r.client_id
          ? {
              id: r.client_id,
              full_name: r.client_name ?? "",
              email: r.client_email ?? "",
              phone: r.client_phone,
            }
          : null,
      })),
    };
  },

  /** Kept for compatibility: first page of the admin listing. */
  async listAll(limit = 100): Promise<CaseWithClient[]> {
    const { rows } = await this.list({ limit });
    return rows;
  },

  async create({ clientId, module, moduleDetail, createdBy }: CreateCaseInput): Promise<Case> {
    const { data, error } = await supabase
      .from("cases")
      .insert({
        client_id: clientId,
        module,
        module_detail: moduleDetail ?? null,
        created_by: createdBy ?? clientId,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapCase(data) as Case;
  },

  /** Accepts either a UI status key or a full database status. */
  async updateStatus(caseId: string, status: StatusKey | DbCaseStatus): Promise<void> {
    const { error } = await supabase.from("cases").update({ status }).eq("id", caseId);
    if (error) throw error;
  },

  async updatePhase(caseId: string, phase: CasePhase): Promise<void> {
    const { error } = await supabase.from("cases").update({ phase }).eq("id", caseId);
    if (error) throw error;
  },

  /** Client- or staff-initiated cancellation. */
  async cancel(caseId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from("cases")
      .update({ status: "cancelled", cancelled_reason: reason })
      .eq("id", caseId);
    if (error) throw error;
  },

  /** Assign (or unassign, with null) a case to a staff member. */
  async assign(caseId: string, staffId: string | null): Promise<void> {
    const { error } = await supabase
      .from("cases")
      .update({ assigned_to: staffId })
      .eq("id", caseId);
    if (error) throw error;
  },

  /** Status/phase history — the tracking timeline for a case. */
  async timeline(caseId: string): Promise<CaseTimelineEntry[]> {
    const { data, error } = await supabase.rpc("case_timeline", { p_case_id: caseId });
    if (error) throw error;
    return (data ?? []) as CaseTimelineEntry[];
  },
};
