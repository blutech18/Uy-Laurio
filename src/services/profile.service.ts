import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/models";

export const profileService = {
  async update(
    userId: string,
    patch: Partial<Pick<Profile, "full_name" | "phone">>,
  ): Promise<Profile> {
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
