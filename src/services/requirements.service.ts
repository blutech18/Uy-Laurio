import { supabase } from "@/lib/supabase";
import type { CaseRequirement, RequirementTemplate, ServiceModule } from "@/types/models";

export interface AddRequirementInput {
  caseId: string;
  name: string;
  note?: string | null;
  urgent?: boolean;
  sortOrder?: number;
}

export const requirementsService = {
  async listForCase(caseId: string): Promise<CaseRequirement[]> {
    const { data, error } = await supabase
      .from("case_requirements")
      .select("*")
      .eq("case_id", caseId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Clients may only flip this when a document is already linked (enforced by
   * the `enforce_client_requirement_update` trigger); staff may set it freely.
   */
  async setFulfilled(requirementId: string, fulfilled: boolean): Promise<void> {
    const { error } = await supabase
      .from("case_requirements")
      .update({ fulfilled })
      .eq("id", requirementId);
    if (error) throw error;
  },

  /** Staff-only: record that a requirement was checked and accepted. */
  async verify(requirementId: string, verifiedBy: string): Promise<void> {
    const { error } = await supabase
      .from("case_requirements")
      .update({
        fulfilled: true,
        verified_by: verifiedBy,
        verified_at: new Date().toISOString(),
      })
      .eq("id", requirementId);
    if (error) throw error;
  },

  /** Staff-only: ask the client for an extra document on this case. */
  async addToCase({
    caseId,
    name,
    note,
    urgent = false,
    sortOrder = 99,
  }: AddRequirementInput): Promise<CaseRequirement> {
    const { data, error } = await supabase
      .from("case_requirements")
      .insert({
        case_id: caseId,
        name,
        note: note ?? null,
        urgent,
        sort_order: sortOrder,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeFromCase(requirementId: string): Promise<void> {
    const { error } = await supabase
      .from("case_requirements")
      .delete()
      .eq("id", requirementId);
    if (error) throw error;
  },

  // ─── Templates: the checklist definitions new cases are built from ────────

  async listTemplates(): Promise<RequirementTemplate[]> {
    const { data, error } = await supabase
      .from("requirement_templates")
      .select("*")
      .order("module", { ascending: true, nullsFirst: true })
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async createTemplate(input: {
    module: ServiceModule | null;
    name: string;
    note?: string | null;
    urgent?: boolean;
    sortOrder?: number;
  }): Promise<RequirementTemplate> {
    const { data, error } = await supabase
      .from("requirement_templates")
      .insert({
        module: input.module,
        name: input.name,
        note: input.note ?? null,
        urgent: input.urgent ?? false,
        sort_order: input.sortOrder ?? 99,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async updateTemplate(
    id: string,
    patch: Partial<Pick<RequirementTemplate, "name" | "note" | "urgent" | "sort_order" | "active">>,
  ): Promise<void> {
    const { error } = await supabase
      .from("requirement_templates")
      .update(patch)
      .eq("id", id);
    if (error) throw error;
  },

  async deleteTemplate(id: string): Promise<void> {
    const { error } = await supabase.from("requirement_templates").delete().eq("id", id);
    if (error) throw error;
  },
};
