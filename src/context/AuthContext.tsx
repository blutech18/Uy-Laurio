import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { claimFirstVisit, rememberSignedIn } from "@/lib/visitor";
import { authService } from "@/services/auth.service";
import type { Profile, Role } from "@/types/models";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  loading: boolean;
  /** True when this account is signing in for the first time on this device. */
  isFirstSession: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFirstSession, setIsFirstSession] = useState(false);
  // Cache per user id so React's double-invoked effects cannot consume the
  // one-shot "first visit" marker and report a first login as a return visit.
  const firstVisitRef = useRef<Record<string, boolean>>({});

  const resolveFirstVisit = useCallback((userId: string) => {
    const cached = firstVisitRef.current[userId];
    if (cached !== undefined) return cached;
    const first = claimFirstVisit(userId);
    firstVisitRef.current[userId] = first;
    return first;
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const p = await authService.getProfile(userId);
      setProfile(p);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) {
        setIsFirstSession(resolveFirstVisit(data.session.user.id));
        rememberSignedIn();
        await loadProfile(data.session.user.id);
      }
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next);
      if (next?.user) {
        setIsFirstSession(resolveFirstVisit(next.user.id));
        rememberSignedIn();
        await loadProfile(next.user.id);
      } else {
        setProfile(null);
        setIsFirstSession(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, resolveFirstVisit]);

  const signOut = useCallback(async () => {
    await authService.signOut();
    setProfile(null);
    setSession(null);
    setIsFirstSession(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      role: profile?.role ?? null,
      loading,
      isFirstSession,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, isFirstSession, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
