import { supabase } from "@/lib/supabase";
import type {
  Case,
  CasePhase,
  CaseWithClient,
  ServiceModule,
  StatusKey,
} from "@/types/models";

export interface CreateCaseInput {
  clientId: string;
  module: ServiceModule;
  moduleDetail?: string | null;
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
    return data ?? [];
  },

  /** All cases with client details — admins only (enforced by RLS). */
  async listAll(): Promise<CaseWithClient[]> {
    const { data, error } = await supabase
      .from("cases")
      .select(
        "*, client:profiles!cases_client_id_fkey (id, full_name, email, phone)",
      )
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as CaseWithClient[];
  },

  async create({ clientId, module, moduleDetail }: CreateCaseInput): Promise<Case> {
    const { data, error } = await supabase
      .from("cases")
      .insert({ client_id: clientId, module, module_detail: moduleDetail ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async updateStatus(caseId: string, status: StatusKey): Promise<void> {
    const { error } = await supabase
      .from("cases")
      .update({ status })
      .eq("id", caseId);
    if (error) throw error;
  },

  async updatePhase(caseId: string, phase: CasePhase): Promise<void> {
    const { error } = await supabase
      .from("cases")
      .update({ phase })
      .eq("id", caseId);
    if (error) throw error;
  },
};
