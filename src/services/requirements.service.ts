import { supabase } from "@/lib/supabase";
import type { CaseRequirement } from "@/types/models";

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

  async setFulfilled(requirementId: string, fulfilled: boolean): Promise<void> {
    const { error } = await supabase
      .from("case_requirements")
      .update({ fulfilled })
      .eq("id", requirementId);
    if (error) throw error;
  },
};
