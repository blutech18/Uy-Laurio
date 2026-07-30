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

    // A deactivated account keeps its credentials but must not get a session.
    const userId = data.user?.id;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_active")
        .eq("id", userId)
        .maybeSingle();

      if (profile && profile.is_active === false) {
        await supabase.auth.signOut();
        throw new Error("This account has been deactivated. Please contact the office.");
      }
    }
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

  /** Emails a password-reset link back to this app. */
  async requestPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  },

  /** Completes a reset, or changes the password of the signed-in user. */
  async updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  /**
   * Fires when the user arrives from a password-reset email. Supabase creates a
   * temporary session at that point, so the app must collect a new password
   * instead of dropping them into the portal.
   */
  onPasswordRecovery(callback: () => void): () => void {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") callback();
    });
    return () => data.subscription.unsubscribe();
  },

  async resendVerification(email: string) {
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
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
