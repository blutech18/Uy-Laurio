import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/models";

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

export const authService = {
  async signInWithPassword(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    return data;
  },

  async signUp({ email, password, fullName, phone }: SignUpInput) {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName, phone: phone ?? null },
      },
    });
    if (error) throw error;
    return data;
  },

  async signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};
