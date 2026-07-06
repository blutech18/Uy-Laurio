import { useEffect, useMemo, useRef, useState } from "react";
import {
  Scale, Bell, Upload, FileText, CheckCircle, AlertCircle, Clock,
  ChevronRight, Eye, EyeOff, History, Send, Flag, ChevronLeft,
  Mail, Smartphone, Calendar, LayoutDashboard, ShieldCheck,
  LogOut, User, Inbox, X, Loader2,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { authService } from "@/services/auth.service";
import { profileService } from "@/services/profile.service";
import { casesService } from "@/services/cases.service";
import { documentsService } from "@/services/documents.service";
import { notificationsService } from "@/services/notifications.service";
import { scheduleService } from "@/services/schedule.service";
import { useClientPortal } from "@/hooks/useClientPortal";
import { useAdminCases } from "@/hooks/useAdminCases";
import { useNotifications } from "@/hooks/useNotifications";
import { useSchedule } from "@/hooks/useSchedule";
import { formatBytes, formatDate, formatDateTime, moduleLabel, timeAgo } from "@/lib/format";
import type {
  CasePhase, CaseWithClient, OverrideType,
  Role, ScheduleOverride, ServiceModule, StatusKey,
} from "@/types/models";

// ─── Types ───────────────────────────────────────────────────────────────────

type UserTab = "dashboard" | "history" | "schedule" | "profile";
type AdminTab = "dashboard" | "worklist" | "verify" | "schedule" | "notifications";

// ─── UI Configuration (static presentation config, not domain data) ──────────

const statusConfig: Record<StatusKey, { label: string; pill: string }> = {
  pending:  { label: "Under Review",            pill: "bg-[#A0A0A0]/15 text-[#6b6b6b]" },
  progress: { label: "In Progress",             pill: "bg-[#D97706]/12 text-[#D97706]" },
  waiting:  { label: "Action Required",         pill: "bg-[#DC2626]/10 text-[#DC2626]" },
  done:     { label: "Approved",                pill: "bg-[#16A34A]/10 text-[#16A34A]" },
};

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const phases: CasePhase[] = [
  "Submitted", "Under Review", "In Progress",
  "Requirement Verification", "Final Sign-off / Execution",
];

// ─── Shared loading / empty states ────────────────────────────────────────────

function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[#6b6b6b] text-sm">
      <Loader2 size={16} className="animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-[#6b6b6b]">
      <Inbox size={22} className="text-[#A0A0A0]" />
      <p className="text-xs">{message}</p>
    </div>
  );
}

// ─── Shared UI Atoms ─────────────────────────────────────────────────────────

function CrestMark({ size = 80, light = false }: { size?: number; light?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-full border-4 select-none shrink-0"
      style={{ width: size, height: size,
        borderColor: light ? "rgba(255,255,255,0.5)" : "#8A1C1F",
        background:  light ? "rgba(255,255,255,0.08)" : "#f5f0ef" }}>
      <Scale size={size * 0.38} color={light ? "#fff" : "#8A1C1F"} strokeWidth={1.5} />
      <span style={{ fontFamily:"'Cinzel',serif", fontSize: size * 0.11,
        color: light ? "#fff" : "#8A1C1F", letterSpacing:"0.08em",
        marginTop: 2, fontWeight: 700, lineHeight: 1 }}>
        UY·LAURIO
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: StatusKey }) {
  const { label, pill } = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${pill}`}>
      {status === "done"     && <CheckCircle size={9} />}
      {status === "waiting"  && <AlertCircle size={9} />}
      {status === "progress" && <Clock       size={9} />}
      {status === "pending"  && <Inbox       size={9} />}
      {label}
    </span>
  );
}

// ─── Top Navigation Bar ───────────────────────────────────────────────────────

const userTabDefs: { id: UserTab; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { id: "history",   label: "History",   icon: <History          size={18} /> },
  { id: "schedule",  label: "Schedule",  icon: <Calendar         size={18} /> },
  { id: "profile",   label: "Profile",   icon: <User             size={18} /> },
];

const adminTabDefs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard",     label: "Dashboard",     icon: <LayoutDashboard size={18} /> },
  { id: "worklist",      label: "Worklist",      icon: <ShieldCheck     size={18} /> },
  { id: "verify",        label: "Verify",        icon: <FileText        size={18} /> },
  { id: "schedule",      label: "Schedule",      icon: <Calendar        size={18} /> },
  { id: "notifications", label: "Notifications", icon: <Bell            size={18} /> },
];

function TopNav({
  role, tab, setTab, onLogout, notifCount = 0,
}: {
  role: Role;
  tab: string;
  setTab: (t: any) => void;
  onLogout: () => void;
  notifCount?: number;
}) {
  const tabs = role === "admin" ? adminTabDefs : userTabDefs;
  const isUser = role === "user";

  return (
    <>
      {/* ── Desktop / tablet top bar ─────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-[#1E1E1E] border-b border-white/8 shadow-lg hidden sm:block">
        <div className="max-w-screen-xl mx-auto px-5 flex items-center h-14 gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <CrestMark size={28} light />
            <span style={{ fontFamily:"'Cinzel',serif" }}
              className="text-white text-sm font-bold tracking-wide leading-none hidden lg:block">
              Uy-Laurio
            </span>
          </div>

          <div className="h-5 w-px bg-white/15 shrink-0" />

          {/* Tabs */}
          <nav className="flex items-end flex-1 h-full overflow-x-auto scrollbar-none gap-0.5">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`h-14 flex items-center gap-2 px-4 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${
                  tab === t.id
                    ? "border-[#8A1C1F] text-white"
                    : "border-transparent text-white/45 hover:text-white/80"
                }`}>
                <span className="hidden lg:block">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${
              role === "admin" ? "bg-[#8A1C1F]/80 text-white" : "bg-white/10 text-white/55"
            }`}>
              {role === "admin" ? "Admin" : "Client"}
            </span>
            <div className="relative">
              <button className="text-white/55 hover:text-white transition-colors p-1">
                <Bell size={17} />
              </button>
              {notifCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#DC2626] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {notifCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#8A1C1F] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {role === "admin" ? "AD" : "JS"}
              </div>
              <span className="hidden md:block text-xs text-white/65 font-medium whitespace-nowrap">
                {role === "admin" ? "Admin" : "Juan S."}
              </span>
            </div>
            <button onClick={onLogout} className="text-white/35 hover:text-white transition-colors p-1" title="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile top bar (branding + bell + avatar) ─────────────────── */}
      {isUser && (
        <header className="sm:hidden sticky top-0 z-40 bg-[#1E1E1E] border-b border-white/8 shadow-md">
          <div className="flex items-center h-13 px-4 gap-3" style={{ height: 52 }}>
            <CrestMark size={26} light />
            <span style={{ fontFamily:"'Cinzel',serif" }} className="text-white text-sm font-bold flex-1 leading-none">
              Uy-Laurio
            </span>
            <div className="relative">
              <button className="text-white/55 hover:text-white p-1.5">
                <Bell size={18} />
              </button>
              {notifCount > 0 && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-[#DC2626] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {notifCount}
                </span>
              )}
            </div>
            <div className="w-7 h-7 rounded-full bg-[#8A1C1F] flex items-center justify-center text-white text-[10px] font-bold">
              JS
            </div>
          </div>
        </header>
      )}

      {/* ── Mobile bottom tab bar (client only) ───────────────────────── */}
      {isUser && (
        <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#1E1E1E] border-t border-white/10 flex"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {userTabDefs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors ${
                tab === t.id ? "text-white" : "text-white/35"
              }`}>
              <span className={`transition-transform ${tab === t.id ? "scale-110" : ""}`}>
                {t.icon}
              </span>
              <span className={`text-[9px] font-semibold tracking-wide ${tab === t.id ? "text-white" : "text-white/35"}`}>
                {t.label}
              </span>
              {tab === t.id && (
                <span className="absolute top-0 w-8 h-0.5 bg-[#8A1C1F] rounded-full" style={{ position:"relative", marginTop:-2 }} />
              )}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

function LoginScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone,    setPhone]    = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState("");
  const [info,     setInfo]     = useState("");
  const [loading,  setLoading]  = useState(false);

  const isSignup = mode === "signup";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      if (isSignup) {
        const { session } = await authService.signUp({ email, password, fullName, phone });
        // When email confirmation is enabled there is no session yet.
        if (!session) {
          setInfo("Account created. Check your email to confirm, then sign in.");
          setMode("signin");
        }
      } else {
        await authService.signInWithPassword(email, password);
      }
      // On success the AuthProvider's listener updates the session and the app
      // routes to the correct portal automatically.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    try {
      await authService.signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    }
  };

  return (
    <div className="min-h-screen flex" style={{ fontFamily:"'Inter',sans-serif" }}>
      {/* Left pane — hidden on mobile */}
      <div className="hidden md:flex w-[44%] bg-[#8A1C1F] flex-col items-center justify-between py-16 px-12 relative overflow-hidden">
        {/* Decorative rings */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <div className="w-[560px] h-[560px] rounded-full border border-white/4" />
          <div className="absolute w-[400px] h-[400px] rounded-full border border-white/6" />
          <div className="absolute w-[250px] h-[250px] rounded-full border border-white/8" />
        </div>

        {/* Top logo */}
        <div className="relative z-10 flex items-center gap-3">
          <CrestMark size={32} light />
          <span style={{ fontFamily:"'Cinzel',serif" }} className="text-white font-bold text-sm tracking-wide">
            Uy-Laurio Legal
          </span>
        </div>

        {/* Center content */}
        <div className="relative z-10 flex flex-col items-center text-center">
          <CrestMark size={112} light />
          <h2 style={{ fontFamily:"'Cinzel',serif" }}
            className="text-3xl font-black text-white tracking-wide mt-7 mb-2">
            Uy-Laurio
          </h2>
          <p className="text-white/55 text-sm">Legal & Notarial Services</p>
          <p className="text-white/40 text-xs leading-relaxed max-w-[240px] mx-auto mt-5">
            Secure client portal for document tracking, submission, and legal consultation management.
          </p>
        </div>

        {/* Bottom address */}
        <div className="relative z-10 text-center">
          <p className="text-white/30 text-[10px] leading-relaxed">
            1st Flr., Bolonio Valdez Bldg., D. Silang St.<br />
            Corner P. Burgos St., Brgy. 10, Batangas City, 4200
          </p>
        </div>
      </div>

      {/* Right pane — full width on mobile */}
      <div className="flex-1 bg-white flex items-center justify-center px-6 sm:px-10 py-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="md:hidden mb-8 flex flex-col items-center gap-3">
            <CrestMark size={56} />
            <p style={{ fontFamily:"'Cinzel',serif" }} className="text-[#8A1C1F] font-bold text-base tracking-wide">
              Uy-Laurio Legal
            </p>
          </div>

          <h1 style={{ fontFamily:"'Cinzel',serif" }}
            className="text-2xl sm:text-3xl font-bold text-[#1E1E1E] mb-1">
            {isSignup ? "Create Account" : "Welcome Back"}
          </h1>
          <p className="text-[#6b6b6b] text-sm mb-8">
            {isSignup
              ? "Register to start tracking your legal documents."
              : "Sign in to access your client portal."}
          </p>

          {/* Google Sign-In button */}
          <button
            type="button"
            onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-3 border border-black/15 bg-white hover:bg-[#f5f5f5] transition-colors rounded-xl py-3 text-sm font-semibold text-[#1E1E1E] shadow-sm mb-6">
            {/* Google "G" logo SVG */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-black/8" />
            <span className="text-[11px] text-[#A0A0A0] font-medium">
              {isSignup ? "or register with email" : "or sign in with email"}
            </span>
            <div className="flex-1 h-px bg-black/8" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">Full Name</label>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan D. Santos" autoComplete="name" required
                    className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">Phone <span className="text-[#A0A0A0] font-normal">(optional)</span></label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)}
                    placeholder="+63 912 345 6789" autoComplete="tel"
                    className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all" />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)}
                type="email" placeholder="you@email.com"
                autoComplete="email" required
                className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">Password</label>
              <div className="relative">
                <input value={password} onChange={(e) => setPassword(e.target.value)}
                  type={showPass ? "text" : "password"} placeholder="••••••••"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  minLength={6} required
                  className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all pr-12" />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#6b6b6b] hover:text-[#1E1E1E]">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
                <AlertCircle size={13} className="shrink-0" /> {error}
              </div>
            )}
            {info && (
              <div className="flex items-center gap-2 text-[#16A34A] text-xs bg-[#16A34A]/8 border border-[#16A34A]/20 rounded-xl px-3.5 py-3">
                <CheckCircle size={13} className="shrink-0" /> {info}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-[#8A1C1F] text-white py-3.5 rounded-xl font-semibold text-sm hover:bg-[#6d1518] active:scale-[0.99] transition-all mt-1 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading && <Loader2 size={15} className="animate-spin" />}
              {isSignup ? "Create Account" : "Sign In"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#6b6b6b]">
            {isSignup ? "Already have an account?" : "New to Uy-Laurio?"}{" "}
            <button
              type="button"
              onClick={() => { setMode(isSignup ? "signin" : "signup"); setError(""); setInfo(""); }}
              className="text-[#8A1C1F] font-semibold hover:underline">
              {isSignup ? "Sign in" : "Create an account"}
            </button>
          </p>

          <p className="mt-6 text-center text-xs text-[#A0A0A0]">
            By continuing you agree to our{" "}
            <a href="#" className="text-[#8A1C1F] hover:underline font-medium">Terms of Service</a>
            {" "}and{" "}
            <a href="#" className="text-[#8A1C1F] hover:underline font-medium">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL TABS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Client: Dashboard ───────────────────────────────────────────────────────

// ─── EJS Requirements Modal ──────────────────────────────────────────────────

const ejsRequirements = [
  { item: "Death Certificate of the deceased",              note: "PSA-authenticated original"                   },
  { item: "Birth Certificates of all heirs",               note: "PSA copies for each heir"                     },
  { item: "Marriage Certificate (if applicable)",          note: "PSA-authenticated"                            },
  { item: "Title of the property / TCT / OCT",            note: "Original owner's copy"                        },
  { item: "Latest Tax Declaration",                        note: "Issued by the local assessor's office"        },
  { item: "Real Property Tax Clearance",                   note: "Current year, from the city/municipal treasurer"},
  { item: "Valid IDs of all heirs",                        note: "Government-issued, front and back"            },
  { item: "Tax Identification Numbers of all heirs",       note: "BIR TIN for each heir"                       },
];

function EJSModal({ onClose }: { onClose: () => void }) {
  const [optionalUpload, setOptionalUpload] = useState(false);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(30,30,30,0.55)", backdropFilter: "blur(4px)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        style={{ fontFamily: "'Inter',sans-serif" }}>
        {/* Header */}
        <div className="bg-[#344248] px-6 py-5 flex items-start justify-between shrink-0">
          <div>
            <p className="text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-1">Requirements Reminder</p>
            <h2 style={{ fontFamily: "'Cinzel',serif" }} className="text-lg font-bold text-white leading-tight">
              Extra-Judicial Settlement
            </h2>
            <p className="text-white/60 text-xs mt-1">Please bring the following physical documents to the office.</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors mt-0.5 shrink-0 ml-4">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Notice banner */}
          <div className="mx-5 mt-4 bg-[#D97706]/10 border border-[#D97706]/25 rounded-lg px-4 py-3 flex gap-2.5">
            <AlertCircle size={14} className="text-[#D97706] shrink-0 mt-0.5" />
            <p className="text-xs text-[#D97706] leading-relaxed font-medium">
              EJS documents are complex and must be reviewed in person. Physical originals are required —
              photo uploads are <strong>optional</strong> and for reference only.
            </p>
          </div>

          {/* Checklist */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-[10px] font-semibold text-[#344248] uppercase tracking-widest mb-3">Document Checklist</p>
            <div className="divide-y divide-black/5 border border-black/8 rounded-xl overflow-hidden">
              {ejsRequirements.map((r, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3 bg-white hover:bg-[#f5f5f5] transition-colors">
                  <div className="w-5 h-5 rounded-full border-2 border-[#344248]/30 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[9px] font-bold text-[#344248]/60">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#1E1E1E] leading-tight">{r.item}</p>
                    <p className="text-[10px] text-[#6b6b6b] mt-0.5">{r.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Optional upload toggle */}
          <div className="px-5 pb-5 pt-3">
            <button onClick={() => setOptionalUpload(!optionalUpload)}
              className="w-full flex items-center justify-between px-4 py-3 border border-dashed border-[#344248]/30 rounded-xl text-sm text-[#344248] hover:bg-[#344248]/4 transition-colors">
              <span className="font-semibold text-xs">Optional: Upload document photos for reference</span>
              <ChevronRight size={14} className={`transition-transform ${optionalUpload ? "rotate-90" : ""}`} />
            </button>

            {optionalUpload && (
              <div className="mt-3"
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={() => setDragging(false)}>
                <div className={`border-2 border-dashed rounded-xl py-8 flex flex-col items-center text-center transition-all ${
                  dragging ? "border-[#344248] bg-[#344248]/8" : "border-[#344248]/25 bg-[#344248]/3"
                }`}>
                  <Upload size={18} className="text-[#344248] mb-2" />
                  <p className="text-xs font-semibold text-[#344248] mb-0.5">Drop files here or browse</p>
                  <p className="text-[10px] text-[#6b6b6b]">JPG, PNG or PDF · Max 25 MB · For reference only</p>
                  <button className="mt-3 text-[10px] font-semibold bg-[#344248] text-white px-4 py-1.5 rounded-lg hover:bg-[#2a3540] transition-colors">
                    Browse Files
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-black/8 flex gap-3 shrink-0 bg-[#FDFDFD]">
          <button onClick={onClose}
            className="flex-1 border border-black/15 text-[#344248] text-sm font-semibold py-2.5 rounded-lg hover:bg-[#f0f0f0] transition-colors">
            Close
          </button>
          <button onClick={onClose}
            className="flex-1 bg-[#8A1C1F] text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-[#6d1518] transition-colors">
            I Understand — Proceed
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ID Upload Slot ───────────────────────────────────────────────────────────

function IDUploadSlot({
  label, sub, file, onFile,
}: {
  label: string;
  sub: string;
  file: File | null;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const uploaded = !!file;
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()}
        className={`flex-1 flex flex-col items-center justify-center gap-2 py-5 border-2 border-dashed rounded-xl transition-all text-center ${
          uploaded
            ? "border-[#16A34A] bg-[#16A34A]/6"
            : "border-[#A0A0A0]/40 bg-[#f5f5f5] hover:border-[#8A1C1F]/40 hover:bg-[#8A1C1F]/3"
        }`}>
        {uploaded
          ? <CheckCircle size={20} className="text-[#16A34A]" />
          : <Upload size={18} className="text-[#6b6b6b]" />}
        <div>
          <p className={`text-xs font-semibold ${uploaded ? "text-[#16A34A]" : "text-[#1E1E1E]"}`}>{label}</p>
          <p className="text-[10px] text-[#6b6b6b] mt-0.5 truncate max-w-[120px]">
            {uploaded ? file!.name : sub}
          </p>
        </div>
      </button>
      <input ref={ref} type="file" hidden accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }} />
    </>
  );
}

// ─── Notarization Sub-type Selector ──────────────────────────────────────────

const notarizationTypes = [
  { id: "contract",  label: "Contract",                  desc: "Agreements, leases, employment contracts" },
  { id: "affidavit", label: "Affidavit",                 desc: "Sworn statements and declarations"        },
  { id: "spa",       label: "Special Power of Attorney", desc: "Authorize another to act on your behalf"  },
  { id: "other",     label: "Other (Please specify)",    desc: "Any other document requiring notarization" },
];

function NotarizationPicker({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const [otherText, setOtherText] = useState("");
  return (
    <div className="space-y-2">
      {notarizationTypes.map((t) => (
        <div key={t.id}>
          <button onClick={() => onSelect(t.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
              selected === t.id
                ? "border-[#8A1C1F] bg-[#8A1C1F]/4"
                : "border-black/8 bg-white hover:border-[#8A1C1F]/30 hover:bg-[#f5f0ef]"
            }`}>
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
              selected === t.id ? "border-[#8A1C1F] bg-[#8A1C1F]" : "border-[#A0A0A0]"
            }`}>
              {selected === t.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold leading-tight ${selected === t.id ? "text-[#8A1C1F]" : "text-[#1E1E1E]"}`}>
                {t.label}
              </p>
              <p className="text-[10px] text-[#6b6b6b] mt-0.5">{t.desc}</p>
            </div>
          </button>
          {selected === "other" && t.id === "other" && (
            <div className="mt-2 ml-7">
              <input value={otherText} onChange={(e) => setOtherText(e.target.value)}
                placeholder="Describe the document type..."
                className="w-full border border-black/15 rounded-lg px-3 py-2.5 text-sm bg-[#f5f5f5] outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Service Card ────────────────────────────────────────────────────────

type ServiceCategory = "notarization" | "deed" | "ejs";

const serviceCategories: { id: ServiceCategory; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    id:    "notarization",
    label: "Notarization Services",
    desc:  "Authentication of legal documents requiring a notary public",
    icon:  <Scale size={18} className="text-[#8A1C1F]" />,
  },
  {
    id:    "deed",
    label: "Deed of Sale",
    desc:  "Full preparation and verification of property transfer documents",
    icon:  <FileText size={18} className="text-[#344248]" />,
  },
  {
    id:    "ejs",
    label: "Extra-Judicial Settlement",
    desc:  "Settlement of estate without court proceedings",
    icon:  <Inbox size={18} className="text-[#D97706]" />,
  },
];

function ServiceSelectionCard({ onEJS, onSubmitted }: { onEJS: () => void; onSubmitted: () => void }) {
  const { profile } = useAuth();
  const [selected, setSelected]         = useState<ServiceCategory | null>(null);
  const [notarizeSub, setNotarizeSub]   = useState("contract");
  const [step, setStep]                 = useState<"select" | "upload">("select");
  const [dragging, setDragging]         = useState(false);
  const [idFront, setIdFront]           = useState<File | null>(null);
  const [idBack,  setIdBack]            = useState<File | null>(null);
  const [docFile, setDocFile]           = useState<File | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState("");
  const docInputRef = useRef<HTMLInputElement>(null);

  const handleContinue = () => {
    if (!selected) return;
    if (selected === "ejs") { onEJS(); return; }
    setStep("upload");
  };

  const resetForm = () => {
    setSelected(null); setNotarizeSub("contract"); setStep("select");
    setIdFront(null); setIdBack(null); setDocFile(null); setError("");
  };

  const handleSubmit = async () => {
    if (!profile || !selected || selected === "ejs") return;
    if (!idFront || !idBack) { setError("Both sides of a valid government ID are required."); return; }
    if (!docFile) { setError("Please attach the signed document."); return; }
    setError("");
    setSubmitting(true);
    try {
      const created = await casesService.create({
        clientId: profile.id,
        module: selected as ServiceModule,
        moduleDetail: selected === "notarization"
          ? notarizationTypes.find((t) => t.id === notarizeSub)?.label ?? null
          : null,
      });
      for (const file of [idFront, idBack, docFile]) {
        await documentsService.upload({ file, caseId: created.id, ownerId: profile.id });
      }
      resetForm();
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "upload") {
    return (
      <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
        {/* Card header */}
        <div className="px-6 py-4 border-b border-black/6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep("select")}
              className="w-7 h-7 rounded-lg border border-black/10 flex items-center justify-center hover:bg-[#f0f0f0] transition-colors">
              <ChevronLeft size={14} className="text-[#344248]" />
            </button>
            <div>
              <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-base leading-tight">
                Upload Documents
              </h2>
              <p className="text-[10px] text-[#6b6b6b] mt-0.5">
                {selected === "notarization"
                  ? `Notarization · ${notarizationTypes.find((t) => t.id === notarizeSub)?.label}`
                  : "Deed of Sale"}
              </p>
            </div>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#16A34A]" />
            <div className="w-8 h-0.5 bg-[#16A34A]" />
            <div className="w-2 h-2 rounded-full bg-[#8A1C1F]" />
            <div className="w-8 h-0.5 bg-[#A0A0A0]/30" />
            <div className="w-2 h-2 rounded-full bg-[#A0A0A0]/30" />
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Mandatory ID section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold text-white bg-[#DC2626] px-2 py-0.5 rounded-full uppercase tracking-wide">
                Required
              </span>
              <p className="text-xs font-semibold text-[#1E1E1E]">Valid Government-Issued ID</p>
            </div>
            <div className="flex gap-3">
              <IDUploadSlot label="Front of ID" sub="Tap to upload front" file={idFront} onFile={setIdFront} />
              <IDUploadSlot label="Back of ID"  sub="Tap to upload back"  file={idBack}  onFile={setIdBack} />
            </div>
            <p className="text-[10px] text-[#6b6b6b] mt-2 flex items-center gap-1">
              <AlertCircle size={10} className="text-[#DC2626]" />
              Both sides of your valid government ID are mandatory for all services.
            </p>
          </div>

          {/* Document upload */}
          <div>
            <p className="text-xs font-semibold text-[#1E1E1E] mb-3">Signed Document</p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) setDocFile(f);
              }}
              onClick={() => docInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl py-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                docFile
                  ? "border-[#16A34A] bg-[#16A34A]/6"
                  : dragging
                  ? "border-[#8A1C1F] bg-[#8A1C1F]/4 scale-[1.01]"
                  : "border-[#344248]/30 bg-[#344248]/3 hover:border-[#344248]/60 hover:bg-[#344248]/6"
              }`}>
              <div className="w-11 h-11 rounded-full bg-[#344248]/10 flex items-center justify-center mb-3">
                {docFile ? <CheckCircle size={18} className="text-[#16A34A]" /> : <Upload size={18} className="text-[#344248]" />}
              </div>
              <p className="font-semibold text-[#344248] text-sm mb-1">
                {docFile ? docFile.name : "Drag & Drop Document Here"}
              </p>
              <p className="text-xs text-[#6b6b6b] max-w-xs leading-relaxed">
                {docFile ? "Click to replace the selected file." : "Upload original, fully signed document in black or blue ink."}
              </p>
              <span className="mt-4 bg-[#344248] text-white text-xs font-semibold px-5 py-2 rounded-lg hover:bg-[#2a3540] transition-colors">
                Browse Files
              </span>
              <input ref={docInputRef} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setDocFile(f);
                  e.target.value = "";
                }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["PDF","JPG","PNG","DOCX"].map((ext) => (
                <span key={ext} className="text-[10px] font-semibold bg-[#f5f0ef] text-[#8A1C1F] px-2 py-0.5 rounded-full">.{ext}</span>
              ))}
              <span className="text-[10px] text-[#6b6b6b] self-center">· Max 25 MB</span>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
              <AlertCircle size={13} className="shrink-0" /> {error}
            </div>
          )}

          {/* Submit */}
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full bg-[#8A1C1F] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#6d1518] transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {submitting ? "Submitting…" : "Submit for Review"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-black/6 flex items-center justify-between">
        <div>
          <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-base">New Submission</h2>
          <p className="text-xs text-[#6b6b6b] mt-0.5">Select the service type that applies to your document.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#8A1C1F]" />
          <div className="w-8 h-0.5 bg-[#A0A0A0]/30" />
          <div className="w-2 h-2 rounded-full bg-[#A0A0A0]/30" />
          <div className="w-8 h-0.5 bg-[#A0A0A0]/30" />
          <div className="w-2 h-2 rounded-full bg-[#A0A0A0]/30" />
        </div>
      </div>

      <div className="p-6 space-y-3">
        {/* Service category tiles */}
        {serviceCategories.map((cat) => (
          <div key={cat.id}>
            <button onClick={() => setSelected(selected === cat.id ? null : cat.id)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl border-2 text-left transition-all ${
                selected === cat.id
                  ? cat.id === "ejs"
                    ? "border-[#D97706] bg-[#D97706]/5"
                    : cat.id === "deed"
                    ? "border-[#344248] bg-[#344248]/5"
                    : "border-[#8A1C1F] bg-[#8A1C1F]/4"
                  : "border-black/8 bg-[#FDFDFD] hover:border-black/20 hover:bg-white"
              }`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                cat.id === "ejs" ? "bg-[#D97706]/10" : cat.id === "deed" ? "bg-[#344248]/10" : "bg-[#8A1C1F]/8"
              }`}>
                {cat.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1E1E1E]">{cat.label}</p>
                <p className="text-[10px] text-[#6b6b6b] mt-0.5">{cat.desc}</p>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                selected === cat.id
                  ? cat.id === "ejs" ? "border-[#D97706] bg-[#D97706]"
                    : cat.id === "deed" ? "border-[#344248] bg-[#344248]"
                    : "border-[#8A1C1F] bg-[#8A1C1F]"
                  : "border-[#A0A0A0]/50"
              }`}>
                {selected === cat.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
            </button>

            {/* Notarization sub-types — expandable */}
            {selected === "notarization" && cat.id === "notarization" && (
              <div className="ml-4 mt-2 pl-4 border-l-2 border-[#8A1C1F]/20">
                <p className="text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-widest mb-2.5">
                  Select Document Type
                </p>
                <NotarizationPicker selected={notarizeSub} onSelect={setNotarizeSub} />
              </div>
            )}

            {/* EJS reminder inline hint */}
            {selected === "ejs" && cat.id === "ejs" && (
              <div className="ml-4 mt-2 pl-4 border-l-2 border-[#D97706]/30">
                <div className="bg-[#D97706]/8 border border-[#D97706]/20 rounded-lg px-3.5 py-3 flex gap-2.5">
                  <AlertCircle size={13} className="text-[#D97706] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#D97706] mb-0.5">Physical documents required</p>
                    <p className="text-[10px] text-[#6b6b6b] leading-relaxed">
                      EJS proceedings require original documents brought in person. Click below to view the full checklist of what to prepare.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        <button
          onClick={handleContinue}
          disabled={!selected}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 mt-2 ${
            selected
              ? "bg-[#8A1C1F] text-white hover:bg-[#6d1518]"
              : "bg-[#f0f0f0] text-[#A0A0A0] cursor-not-allowed"
          }`}>
          {selected === "ejs" ? "View Requirements Checklist" : "Continue to Upload"}
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Client Dashboard ─────────────────────────────────────────────────────────

/** Button that opens a native file picker and hands the chosen file back. */
function UploadButton({
  className, children, busy, disabled, onFile,
}: {
  className: string;
  children: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={disabled || busy}
        onClick={() => ref.current?.click()}
        className={`${className} disabled:opacity-50 disabled:cursor-not-allowed`}>
        {busy ? <Loader2 size={11} className="animate-spin" /> : children}
      </button>
      <input ref={ref} type="file" hidden
        accept=".pdf,.jpg,.jpeg,.png,.docx"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }} />
    </>
  );
}

function ClientDashboard() {
  const { profile } = useAuth();
  const {
    activeCase, documents, requirements, loading, error, reload, toggleRequirement,
  } = useClientPortal();
  const [ejsModal, setEjsModal] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const total     = requirements.length;
  const done      = requirements.filter((r) => r.fulfilled).length;
  const remaining = total - done;
  const pct       = total ? Math.round((done / total) * 100) : 0;
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "there";
  const recent    = documents.slice(0, 4);

  const uploadForRequirement = async (reqId: string, file: File) => {
    if (!activeCase || !profile) return;
    setUploadingId(reqId);
    try {
      await documentsService.upload({ file, caseId: activeCase.id, ownerId: profile.id });
      await toggleRequirement(reqId, true);
      await reload();
    } catch {
      /* surfaced via portal error on reload */
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="bg-[#F4F5F7] pb-20 sm:pb-0" style={{ fontFamily:"'Inter',sans-serif", minHeight:"calc(100vh - 56px)" }}>
      {ejsModal && <EJSModal onClose={() => setEjsModal(false)} />}

      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {/* Greeting */}
        <div className="mb-5 sm:mb-7 flex items-start justify-between gap-4">
          <div>
            <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-xl sm:text-2xl font-bold text-[#1E1E1E] mb-0.5">
              Welcome back, {firstName}.
            </h1>
            <p className="text-sm text-[#6b6b6b]">
              <span className="text-[#DC2626] font-semibold">{remaining} pending</span>
              {" "}· <span className="text-[#D97706] font-semibold">
                {requirements.filter((r) => r.urgent && !r.fulfilled).length} action required
              </span>
            </p>
          </div>
          {/* Mobile progress pill */}
          <div className="sm:hidden bg-[#8A1C1F] text-white rounded-xl px-3.5 py-2.5 text-center shrink-0">
            <p style={{ fontFamily:"'Cinzel',serif" }} className="text-xl font-black leading-none">{done}/{total}</p>
            <p className="text-[9px] text-white/60 mt-0.5">docs done</p>
          </div>
        </div>

        {error && (
          <div className="mb-5 flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
            <AlertCircle size={13} className="shrink-0" /> {error}
          </div>
        )}

        {/* Mobile: stacked single column / Desktop: 2-col grid */}
        <div className="flex flex-col xl:grid xl:grid-cols-[1fr_320px] gap-5 sm:gap-6">
          {/* Left column */}
          <div className="flex flex-col gap-5 sm:gap-6">
            <ServiceSelectionCard onEJS={() => setEjsModal(true)} onSubmitted={reload} />

            {/* Recent submissions — card list on mobile, table on sm+ */}
            <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
              <div className="px-4 sm:px-6 py-4 border-b border-black/6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History size={14} className="text-[#344248]" />
                  <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">Recent Submissions</h2>
                </div>
                <span className="text-xs text-[#6b6b6b]">{documents.length} files</span>
              </div>

              {loading ? (
                <Spinner label="Loading submissions…" />
              ) : recent.length === 0 ? (
                <EmptyState message="No documents submitted yet." />
              ) : (
                <>
                  {/* Mobile card list */}
                  <div className="sm:hidden divide-y divide-black/5">
                    {recent.map((r) => (
                      <div key={r.id} className="px-4 py-3.5 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#f5f0ef] flex items-center justify-center shrink-0">
                          <FileText size={14} className="text-[#8A1C1F]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[#1E1E1E] truncate">{r.name}</p>
                          <p className="text-[10px] text-[#6b6b6b] mt-0.5">{formatDateTime(r.submitted_at)}</p>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                    ))}
                  </div>

                  {/* Desktop table */}
                  <table className="hidden sm:table w-full text-sm">
                    <thead>
                      <tr className="bg-[#f5f0ef] text-[10px] font-semibold text-[#344248] uppercase tracking-wider">
                        <th className="px-6 py-3 text-left">File</th>
                        <th className="px-6 py-3 text-left">Submitted</th>
                        <th className="px-6 py-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((r) => (
                        <tr key={r.id} className="border-t border-black/5 hover:bg-[#FDFDFD] transition-colors">
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-md bg-[#f5f0ef] flex items-center justify-center shrink-0">
                                <FileText size={13} className="text-[#8A1C1F]" />
                              </div>
                              <span className="text-[#1E1E1E] font-medium text-xs truncate max-w-[180px]">{r.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-xs text-[#6b6b6b]">{formatDateTime(r.submitted_at)}</td>
                          <td className="px-6 py-3.5"><StatusBadge status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>

          {/* Right column — hidden on mobile (progress shown in greeting pill) */}
          <div className="hidden xl:flex flex-col gap-5">
            <div className="bg-[#8A1C1F] rounded-xl p-5 text-white shadow-sm">
              <p className="text-xs font-semibold text-white/60 uppercase tracking-widest mb-1">Submission Progress</p>
              <p style={{ fontFamily:"'Cinzel',serif" }} className="text-3xl font-black mb-1">{done}/{total}</p>
              <p className="text-xs text-white/60 mb-4">required documents submitted</p>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all duration-500" style={{ width:`${pct}%` }} />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden flex-1">
              <div className="px-5 py-4 border-b border-black/6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} className="text-[#DC2626]" />
                  <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">Pending Documents</h2>
                </div>
                <span className="text-[10px] font-semibold bg-[#DC2626]/10 text-[#DC2626] px-2 py-0.5 rounded-full">
                  {remaining} remaining
                </span>
              </div>
              {loading ? (
                <Spinner />
              ) : total === 0 ? (
                <EmptyState message="No document requirements for your case yet." />
              ) : (
                <div className="divide-y divide-black/5">
                  {requirements.map((doc) => {
                    const isDone = doc.fulfilled;
                    return (
                      <div key={doc.id} className={`px-5 py-4 flex items-start gap-3 transition-colors ${isDone ? "bg-[#16A34A]/4" : ""}`}>
                        <button onClick={() => toggleRequirement(doc.id, !isDone)}
                          className={`mt-0.5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                            isDone ? "bg-[#16A34A] border-[#16A34A]" : doc.urgent ? "border-[#DC2626]" : "border-[#A0A0A0]"
                          }`} style={{ width:18, height:18 }}>
                          {isDone && <CheckCircle size={11} color="white" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold leading-tight ${isDone ? "line-through text-[#A0A0A0]" : "text-[#1E1E1E]"}`}>
                            {doc.name}
                            {doc.urgent && !isDone && (
                              <span className="ml-1.5 text-[9px] font-bold text-[#DC2626] bg-[#DC2626]/10 px-1.5 py-0.5 rounded-full align-middle">Required</span>
                            )}
                          </p>
                          {doc.note && <p className="text-[10px] text-[#6b6b6b] mt-0.5">{doc.note}</p>}
                        </div>
                        {!isDone && (
                          <UploadButton busy={uploadingId === doc.id} disabled={!activeCase}
                            onFile={(f) => uploadForRequirement(doc.id, f)}
                            className="shrink-0 text-[10px] font-semibold text-[#8A1C1F] border border-[#8A1C1F]/30 px-2.5 py-1 rounded-md hover:bg-[#8A1C1F] hover:text-white transition-colors">
                            Upload
                          </UploadButton>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="px-5 py-3 border-t border-black/6 bg-[#FDFDFD]">
                <p className="text-[10px] text-[#6b6b6b]">All documents must bear original signatures in black or blue ink.</p>
              </div>
            </div>
          </div>

          {/* Mobile pending checklist — shown below service card */}
          <div className="xl:hidden bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
            <div className="px-4 py-4 border-b border-black/6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-[#DC2626]" />
                <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">Pending Documents</h2>
              </div>
              <span className="text-[10px] font-semibold bg-[#DC2626]/10 text-[#DC2626] px-2 py-0.5 rounded-full">
                {remaining} left
              </span>
            </div>
            {/* Progress bar mobile */}
            <div className="px-4 py-3 border-b border-black/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-[#6b6b6b]">{done} of {total} submitted</span>
                <span className="text-[10px] font-bold text-[#8A1C1F]">{pct}%</span>
              </div>
              <div className="h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
                <div className="h-full bg-[#8A1C1F] rounded-full transition-all duration-500" style={{ width:`${pct}%` }} />
              </div>
            </div>
            {loading ? (
              <Spinner />
            ) : total === 0 ? (
              <EmptyState message="No document requirements yet." />
            ) : (
              <div className="divide-y divide-black/5">
                {requirements.map((doc) => {
                  const isDone = doc.fulfilled;
                  return (
                    <div key={doc.id} className={`px-4 py-3.5 flex items-center gap-3 ${isDone ? "bg-[#16A34A]/4" : ""}`}>
                      <button onClick={() => toggleRequirement(doc.id, !isDone)}
                        className={`rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                          isDone ? "bg-[#16A34A] border-[#16A34A]" : doc.urgent ? "border-[#DC2626]" : "border-[#A0A0A0]"
                        }`} style={{ width:20, height:20 }}>
                        {isDone && <CheckCircle size={12} color="white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold ${isDone ? "line-through text-[#A0A0A0]" : "text-[#1E1E1E]"}`}>
                          {doc.name}
                          {doc.urgent && !isDone && (
                            <span className="ml-1.5 text-[9px] font-bold text-[#DC2626] bg-[#DC2626]/10 px-1.5 py-0.5 rounded-full align-middle">Required</span>
                          )}
                        </p>
                        {doc.note && <p className="text-[10px] text-[#6b6b6b] mt-0.5">{doc.note}</p>}
                      </div>
                      {!isDone && (
                        <UploadButton busy={uploadingId === doc.id} disabled={!activeCase}
                          onFile={(f) => uploadForRequirement(doc.id, f)}
                          className="shrink-0 bg-[#8A1C1F] text-white text-[10px] font-semibold px-3 py-1.5 rounded-lg active:opacity-80 transition-opacity">
                          Upload
                        </UploadButton>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Client: History ─────────────────────────────────────────────────────────

function ClientHistory() {
  const { documents, loading, error } = useClientPortal();

  const viewDocument = async (storagePath: string) => {
    try {
      const url = await documentsService.getSignedUrl(storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* ignore — link generation failed */
    }
  };

  return (
    <div className="bg-[#F4F5F7] pb-20 sm:pb-0" style={{ fontFamily:"'Inter',sans-serif", minHeight:"calc(100vh - 56px)" }}>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-xl sm:text-2xl font-bold text-[#1E1E1E] mb-0.5">
          Submission History
        </h1>
        <p className="text-sm text-[#6b6b6b] mb-5 sm:mb-7">All uploaded documents and their processing status.</p>

        {error && (
          <div className="mb-5 flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
            <AlertCircle size={13} className="shrink-0" /> {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-black/6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History size={14} className="text-[#344248]" />
              <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">All Submissions</h2>
            </div>
            <span className="text-xs text-[#6b6b6b]">{documents.length} records</span>
          </div>

          {loading ? (
            <Spinner label="Loading submissions…" />
          ) : documents.length === 0 ? (
            <EmptyState message="You haven't uploaded any documents yet." />
          ) : (
          <>
          {/* Mobile card list */}
          <div className="sm:hidden divide-y divide-black/5">
            {documents.map((r) => (
              <div key={r.id} className="px-4 py-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#f5f0ef] flex items-center justify-center shrink-0 mt-0.5">
                  <FileText size={15} className="text-[#8A1C1F]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1E1E1E] truncate">{r.name}</p>
                  <p className="text-[11px] text-[#6b6b6b] mt-0.5">{formatDateTime(r.submitted_at)} · {formatBytes(r.size_bytes)}</p>
                  <div className="mt-2">
                    <StatusBadge status={r.status} />
                  </div>
                </div>
                <button onClick={() => viewDocument(r.storage_path)} className="text-[#8A1C1F] mt-1 shrink-0">
                  <ChevronRight size={16} />
                </button>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <table className="hidden sm:table w-full text-sm">
            <thead>
              <tr className="bg-[#f5f0ef] text-[10px] font-semibold text-[#344248] uppercase tracking-wider">
                <th className="px-6 py-3 text-left">File</th>
                <th className="px-6 py-3 text-left">Size</th>
                <th className="px-6 py-3 text-left">Submitted</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((r) => (
                <tr key={r.id} className="border-t border-black/5 hover:bg-[#FDFDFD] transition-colors">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-md bg-[#f5f0ef] flex items-center justify-center shrink-0">
                        <FileText size={13} className="text-[#8A1C1F]" />
                      </div>
                      <span className="text-[#1E1E1E] font-medium text-xs">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-xs text-[#6b6b6b]">{formatBytes(r.size_bytes)}</td>
                  <td className="px-6 py-3.5 text-xs text-[#6b6b6b]">{formatDateTime(r.submitted_at)}</td>
                  <td className="px-6 py-3.5"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3.5">
                    <button onClick={() => viewDocument(r.storage_path)}
                      className="text-[#8A1C1F] text-xs font-semibold hover:underline flex items-center gap-1">
                      View <ChevronRight size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shared: Schedule ────────────────────────────────────────────────────────

// ─── Schedule helpers ─────────────────────────────────────────────────────────
//
// The calendar is fully dynamic: it renders the currently viewed month and
// derives each day's status from the standing office rules plus any admin
// overrides stored in the database (keyed by ISO date).

type DayStatus = "open" | "halfday" | "closed" | "sunday";

/** Local (not UTC) YYYY-MM-DD key for a date. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeDayStatus(date: Date, overrides: Record<string, ScheduleOverride>): DayStatus {
  const dow = date.getDay();
  if (dow === 0) return "sunday";                       // Sunday always closed
  const ov = overrides[toISODate(date)];
  if (ov) {
    if (ov.type === "closed") return "closed";
    return "halfday";                                   // halfday or custom hours
  }
  if (dow === 6) return "halfday";                      // Saturday → half-day
  return "open";
}

const FULL_SLOTS = ["9:00 AM","10:00 AM","11:00 AM","1:00 PM","2:00 PM","3:00 PM","4:00 PM"];
const HALF_SLOTS = ["9:00 AM","10:00 AM","11:00 AM"];

function daySlots(status: DayStatus): string[] {
  if (status === "open") return FULL_SLOTS;
  if (status === "halfday") return HALF_SLOTS;
  return [];
}

const STATUS_STYLE: Record<DayStatus, { cell: string; text: string; badge: string; badgeText: string }> = {
  open:    { cell: "hover:bg-[#f5f0ef] cursor-pointer",  text: "text-[#1E1E1E]",        badge: "",                            badgeText: "" },
  halfday: { cell: "bg-[#D97706]/8 cursor-pointer",       text: "text-[#D97706] font-bold", badge: "bg-[#D97706]/20 text-[#D97706]", badgeText: "Half-day" },
  closed:  { cell: "bg-[#DC2626]/8 cursor-not-allowed",   text: "text-[#DC2626]",        badge: "bg-[#DC2626]/15 text-[#DC2626]", badgeText: "Closed" },
  sunday:  { cell: "bg-[#f0f0f0] cursor-not-allowed opacity-60", text: "text-[#A0A0A0]", badge: "bg-[#A0A0A0]/15 text-[#A0A0A0]", badgeText: "Closed" },
};

function formatLongDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

// ─── Time Slot Panel (user side) ─────────────────────────────────────────────

function TimeSlotPanel({
  date, status, takenSlots, onBook, onClose,
}: {
  date: Date;
  status: DayStatus;
  takenSlots: string[];
  onBook: (slot: string) => Promise<void>;
  onClose: () => void;
}) {
  const [booked, setBooked] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const slots = daySlots(status);
  const isHalf = status === "halfday";

  const confirm = async () => {
    if (!booked) return;
    setSubmitting(true);
    try {
      await onBook(booked);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
      <div className="bg-[#344248] px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-white/50 font-semibold uppercase tracking-widest mb-0.5">Book Appointment</p>
          <p style={{ fontFamily:"'Cinzel',serif" }} className="text-white font-bold">{formatLongDate(date)}</p>
        </div>
        <button onClick={onClose} className="text-white/50 hover:text-white transition-colors"><X size={16} /></button>
      </div>

      {isHalf && (
        <div className="mx-4 mt-4 bg-[#D97706]/10 border border-[#D97706]/25 rounded-lg px-3.5 py-2.5 flex gap-2">
          <Clock size={12} className="text-[#D97706] shrink-0 mt-0.5" />
          <p className="text-[10px] text-[#D97706] font-medium leading-relaxed">
            Half-day — office hours end at 12:00 PM. Morning slots only.
          </p>
        </div>
      )}

      <div className="p-4">
        <p className="text-[10px] font-semibold text-[#344248] uppercase tracking-widest mb-3">
          Available Time Slots
        </p>
        <div className="grid grid-cols-2 gap-2">
          {slots.map((slot) => {
            const taken = takenSlots.includes(slot);
            return (
              <button key={slot} disabled={taken}
                onClick={() => setBooked(booked === slot ? null : slot)}
                className={`py-2.5 rounded-lg border-2 text-xs font-semibold transition-all ${
                  taken
                    ? "border-black/5 bg-[#f0f0f0] text-[#A0A0A0] cursor-not-allowed line-through"
                    : booked === slot
                    ? "border-[#8A1C1F] bg-[#8A1C1F] text-white"
                    : "border-black/10 bg-[#f5f5f5] text-[#1E1E1E] hover:border-[#8A1C1F]/50 hover:bg-[#f5f0ef]"
                }`}>
                {slot}
              </button>
            );
          })}
        </div>

        {booked && (
          <button onClick={confirm} disabled={submitting}
            className="mt-4 w-full bg-[#8A1C1F] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#6d1518] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Confirm — {booked}
          </button>
        )}
      </div>

      <div className="px-4 pb-4">
        <p className="text-[10px] text-[#6b6b6b] leading-relaxed border-t border-black/6 pt-3">
          Walk-in appointments are welcome during office hours. For complex matters, please book in advance.
        </p>
      </div>
    </div>
  );
}

// ─── Schedule View ────────────────────────────────────────────────────────────

function ScheduleView({ isAdmin = false }: { isAdmin?: boolean }) {
  const { profile } = useAuth();
  const { overrides, appointments, reload } = useSchedule();

  // Currently displayed month (first day).
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  // Multi-select for admin (ISO date strings).
  const [adminSelected, setAdminSelected] = useState<string[]>([]);
  // User: which date's slot panel is open.
  const [userPicked, setUserPicked] = useState<Date | null>(null);
  // Admin: override editor panel state.
  const [overrideMode, setOverrideMode] = useState<OverrideType>("closed");
  const [customOpen,  setCustomOpen]  = useState("08:00");
  const [customClose, setCustomClose] = useState("17:00");
  const [showOverrides, setShowOverrides] = useState(false);
  const [applying, setApplying] = useState(false);

  const year  = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const offset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthDates = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1));
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // Booked time slots grouped by ISO date.
  const takenByDate = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const a of appointments) {
      if (a.status === "cancelled") continue;
      (map[a.appointment_date] ??= []).push(a.time_slot);
    }
    return map;
  }, [appointments]);

  const monthOverrides = useMemo(
    () => Object.values(overrides)
      .filter((o) => o.override_date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
      .sort((a, b) => a.override_date.localeCompare(b.override_date)),
    [overrides, year, month],
  );

  const shiftMonth = (delta: number) => {
    setViewMonth(new Date(year, month + delta, 1));
    setAdminSelected([]);
    setUserPicked(null);
  };

  const toggleAdminSel = (iso: string) =>
    setAdminSelected((s) => s.includes(iso) ? s.filter((x) => x !== iso) : [...s, iso]);

  const applyOverride = async () => {
    if (!adminSelected.length || !profile) return;
    setApplying(true);
    try {
      for (const iso of adminSelected) {
        await scheduleService.applyOverride({
          date: iso,
          type: overrideMode,
          openTime: overrideMode === "custom" ? customOpen : null,
          closeTime: overrideMode === "custom" ? customClose : null,
          createdBy: profile.id,
        });
      }
      await reload();
      setAdminSelected([]);
    } finally {
      setApplying(false);
    }
  };

  const removeOverride = async (iso: string) => {
    await scheduleService.removeOverride(iso);
    await reload();
  };

  const handleUserClick = (date: Date, status: DayStatus) => {
    if (status === "sunday" || status === "closed") return;
    setUserPicked((prev) => (prev && toISODate(prev) === toISODate(date) ? null : date));
  };

  const bookSlot = async (date: Date, slot: string) => {
    if (!profile) return;
    await scheduleService.book({ clientId: profile.id, date: toISODate(date), timeSlot: slot });
    await reload();
  };

  const pickedStatus = userPicked ? computeDayStatus(userPicked, overrides) : null;
  const pickedTaken = userPicked ? (takenByDate[toISODate(userPicked)] ?? []) : [];

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily:"'Inter',sans-serif" }}>
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between mb-7 gap-4">
          <div>
            <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-2xl font-bold text-[#1E1E1E] mb-1">
              {isAdmin ? "Office Schedule Manager" : "Book an Appointment"}
            </h1>
            <p className="text-sm text-[#6b6b6b]">
              {isAdmin
                ? "Override specific dates to set closures or custom operating hours."
                : "Select an available date to view and book consultation time slots."}
            </p>
          </div>
          {/* Legend chips */}
          <div className="hidden lg:flex items-center gap-3 shrink-0 flex-wrap justify-end">
            {[
              { cls:"bg-white border-black/10", label:"Open"       },
              { cls:"bg-[#D97706]/15 border-[#D97706]/30", label:"Half-Day" },
              { cls:"bg-[#DC2626]/15 border-[#DC2626]/30", label:"Closed"   },
              { cls:"bg-[#f0f0f0] border-[#A0A0A0]/20 opacity-60", label:"Sunday"  },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5 text-[10px] text-[#6b6b6b] font-semibold">
                <div className={`w-3.5 h-3.5 rounded border ${l.cls} shrink-0`} />
                {l.label}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
          {/* Calendar */}
          <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
            {/* Month header */}
            <div className="bg-[#8A1C1F] px-6 py-4 flex items-center justify-between text-white">
              <button onClick={() => shiftMonth(-1)} className="p-1.5 hover:bg-white/15 rounded-lg transition-colors"><ChevronLeft size={16} /></button>
              <div className="text-center">
                <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold tracking-wide">{monthLabel}</h2>
                <p className="text-white/60 text-[10px] mt-0.5">
                  Office Hours: Mon–Fri 9 AM–5 PM · Sat 9 AM–12 PM · Sun Closed
                </p>
              </div>
              <button onClick={() => shiftMonth(1)} className="p-1.5 hover:bg-white/15 rounded-lg transition-colors"><ChevronRight size={16} /></button>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 border-b border-black/6 bg-[#f5f0ef]">
              {DAYS.map((d, i) => (
                <div key={d} className={`py-2.5 text-center text-[10px] font-bold uppercase tracking-wider ${
                  i === 0 ? "text-[#DC2626]" : "text-[#344248]"
                }`}>
                  {d}
                </div>
              ))}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-7">
              {/* Leading blanks so the 1st lands on the right weekday. */}
              {Array.from({ length: offset }).map((_, i) => (
                <div key={`blank-${i}`} className="border-b border-r border-black/5 min-h-[72px] bg-[#fafafa]" />
              ))}

              {monthDates.map((date) => {
                const d = date.getDate();
                const iso = toISODate(date);
                const status  = computeDayStatus(date, overrides);
                const style   = STATUS_STYLE[status];
                const selAdmin = adminSelected.includes(iso);
                const picked  = !!userPicked && toISODate(userPicked) === iso;
                const ov      = overrides[iso];

                return (
                  <button key={iso}
                    onClick={() => isAdmin ? toggleAdminSel(iso) : handleUserClick(date, status)}
                    disabled={!isAdmin && (status === "sunday" || status === "closed")}
                    className={`border-b border-r border-black/5 min-h-[72px] p-2 text-left flex flex-col transition-all relative ${style.cell} ${
                      selAdmin ? "ring-2 ring-inset ring-[#344248] bg-[#344248]/10" : ""
                    } ${picked ? "ring-2 ring-inset ring-[#8A1C1F]" : ""}`}>
                    <span className={`text-sm ${style.text}`}>{d}</span>

                    {/* Status badge */}
                    {style.badge && (
                      <span className={`mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full leading-none ${style.badge}`}>
                        {ov?.type === "custom" && ov.open_time
                          ? `${ov.open_time}–${ov.close_time}`
                          : style.badgeText}
                      </span>
                    )}

                    {/* Slot count for bookable days */}
                    {status === "open" && !picked && (
                      <span className="mt-auto text-[8px] text-[#16A34A] font-semibold">{FULL_SLOTS.length} slots</span>
                    )}
                    {status === "halfday" && !picked && (
                      <span className="mt-auto text-[8px] text-[#D97706] font-semibold">{HALF_SLOTS.length} AM slots</span>
                    )}

                    {/* Admin selected check */}
                    {selAdmin && (
                      <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#344248] flex items-center justify-center">
                        <CheckCircle size={10} color="white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Footer rules bar */}
            <div className="px-5 py-3 bg-[#f5f0ef] border-t border-black/6 flex flex-wrap gap-x-6 gap-y-1">
              {[
                { dot:"bg-[#A0A0A0]",  text:"Sundays — Office closed" },
                { dot:"bg-[#D97706]",  text:"Saturdays & Holidays — AM only (9 AM–12 PM)" },
                { dot:"bg-[#DC2626]",  text:"Admin override — Full closure" },
              ].map((r) => (
                <div key={r.text} className="flex items-center gap-1.5 text-[10px] text-[#6b6b6b]">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.dot}`} />
                  {r.text}
                </div>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex flex-col gap-4">
            {isAdmin ? (
              <>
                {/* Override control panel */}
                <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-black/6">
                    <h3 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">Date Override Panel</h3>
                    <p className="text-[10px] text-[#6b6b6b] mt-0.5">
                      {adminSelected.length
                        ? `${adminSelected.length} date${adminSelected.length > 1 ? "s" : ""} selected — choose override below`
                        : "Click dates on the calendar to select them"}
                    </p>
                  </div>

                  <div className="p-5 space-y-3">
                    {/* Mode selector */}
                    {[
                      { id:"closed"  as const, label:"Full-Day Closure",       icon:"🔴", desc:"Office closed all day"           },
                      { id:"halfday" as const, label:"Half-Day (AM only)",      icon:"🟡", desc:"Open 9 AM – 12 PM only"          },
                      { id:"custom"  as const, label:"Custom Operating Hours",  icon:"🔵", desc:"Set specific open/close times"   },
                    ].map((m) => (
                      <div key={m.id}>
                        <button onClick={() => setOverrideMode(m.id)}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border-2 text-left transition-all ${
                            overrideMode === m.id
                              ? "border-[#344248] bg-[#344248]/5"
                              : "border-black/8 hover:border-black/20 bg-[#FDFDFD]"
                          }`}>
                          <span className="text-base leading-none">{m.icon}</span>
                          <div>
                            <p className={`text-xs font-semibold ${overrideMode === m.id ? "text-[#344248]" : "text-[#1E1E1E]"}`}>
                              {m.label}
                            </p>
                            <p className="text-[10px] text-[#6b6b6b]">{m.desc}</p>
                          </div>
                          <div className={`ml-auto w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            overrideMode === m.id ? "border-[#344248] bg-[#344248]" : "border-[#A0A0A0]/50"
                          }`}>
                            {overrideMode === m.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </div>
                        </button>

                        {/* Custom hours inputs */}
                        {overrideMode === "custom" && m.id === "custom" && (
                          <div className="mt-2 ml-3 grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-[#6b6b6b] mb-1 uppercase tracking-wide">Opens</label>
                              <input type="time" value={customOpen} onChange={(e) => setCustomOpen(e.target.value)}
                                className="w-full border border-black/15 rounded-lg px-2.5 py-2 text-xs bg-[#f5f5f5] outline-none focus:border-[#344248] focus:ring-2 focus:ring-[#344248]/20" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-[#6b6b6b] mb-1 uppercase tracking-wide">Closes</label>
                              <input type="time" value={customClose} onChange={(e) => setCustomClose(e.target.value)}
                                className="w-full border border-black/15 rounded-lg px-2.5 py-2 text-xs bg-[#f5f5f5] outline-none focus:border-[#344248] focus:ring-2 focus:ring-[#344248]/20" />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    <button onClick={applyOverride}
                      disabled={!adminSelected.length || applying}
                      className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
                        adminSelected.length && !applying
                          ? "bg-[#8A1C1F] text-white hover:bg-[#6d1518]"
                          : "bg-[#f0f0f0] text-[#A0A0A0] cursor-not-allowed"
                      }`}>
                      {applying && <Loader2 size={14} className="animate-spin" />}
                      Apply Override{adminSelected.length > 1 ? ` to ${adminSelected.length} Dates` : ""}
                    </button>
                  </div>
                </div>

                {/* Active overrides list (current month) */}
                {monthOverrides.length > 0 && (
                  <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
                    <button onClick={() => setShowOverrides(!showOverrides)}
                      className="w-full px-5 py-3.5 border-b border-black/6 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertCircle size={13} className="text-[#D97706]" />
                        <span style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">
                          Active Overrides
                        </span>
                        <span className="text-[10px] font-bold bg-[#D97706]/15 text-[#D97706] px-2 py-0.5 rounded-full">
                          {monthOverrides.length}
                        </span>
                      </div>
                      <ChevronRight size={14} className={`text-[#6b6b6b] transition-transform ${showOverrides ? "rotate-90" : ""}`} />
                    </button>
                    {showOverrides && (
                      <div className="divide-y divide-black/5">
                        {monthOverrides.map((ov) => (
                          <div key={ov.override_date} className="px-5 py-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-[#1E1E1E]">{formatDate(ov.override_date)}</p>
                              <p className="text-[10px] text-[#6b6b6b]">
                                {ov.type === "closed"  ? "Full-Day Closure" :
                                 ov.type === "halfday" ? "Half-Day (AM only)" :
                                 `Custom: ${ov.open_time}–${ov.close_time}`}
                              </p>
                            </div>
                            <button onClick={() => removeOverride(ov.override_date)}
                              className="text-[#DC2626] hover:bg-[#DC2626]/10 p-1.5 rounded-lg transition-colors">
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Standing rules reminder */}
                <div className="bg-[#1E1E1E] rounded-xl p-4">
                  <p className="text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-3">Standing Rules</p>
                  {[
                    { icon:"🔴", rule:"Sundays — Always closed (system enforced)" },
                    { icon:"🟡", rule:"Saturdays — Half-day by default (9 AM–12 PM)" },
                    { icon:"🟡", rule:"Public Holidays — Half-day by default" },
                  ].map((r) => (
                    <div key={r.rule} className="flex items-start gap-2 mb-2 last:mb-0">
                      <span className="text-xs leading-none mt-0.5">{r.icon}</span>
                      <p className="text-[10px] text-white/60 leading-relaxed">{r.rule}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                {/* User: time slot panel or legend */}
                {userPicked && pickedStatus ? (
                  <TimeSlotPanel date={userPicked} status={pickedStatus}
                    takenSlots={pickedTaken}
                    onBook={(slot) => bookSlot(userPicked, slot)}
                    onClose={() => setUserPicked(null)} />
                ) : (
                  <div className="bg-white rounded-xl border border-black/8 shadow-sm p-5">
                    <h3 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm mb-4">Office Hours</h3>
                    {[
                      { day:"Monday – Friday", hours:"9:00 AM – 5:00 PM", status:"open"    },
                      { day:"Saturday",        hours:"9:00 AM – 12:00 PM", status:"halfday" },
                      { day:"Sunday",          hours:"Closed",             status:"closed"  },
                      { day:"Public Holidays", hours:"9:00 AM – 12:00 PM", status:"halfday" },
                    ].map((r) => (
                      <div key={r.day} className="flex items-center justify-between py-2.5 border-b border-black/5 last:border-0">
                        <span className="text-xs font-medium text-[#1E1E1E]">{r.day}</span>
                        <span className={`text-[10px] font-semibold ${
                          r.status === "open"    ? "text-[#16A34A]" :
                          r.status === "halfday" ? "text-[#D97706]" : "text-[#DC2626]"
                        }`}>{r.hours}</span>
                      </div>
                    ))}
                    <div className="mt-4 bg-[#f5f0ef] rounded-lg px-3.5 py-3">
                      <p className="text-[10px] text-[#8A1C1F] font-semibold mb-1">How to book</p>
                      <p className="text-[10px] text-[#6b6b6b] leading-relaxed">
                        Click any available date on the calendar to see open time slots and confirm your appointment.
                      </p>
                    </div>
                  </div>
                )}

                {/* Next available dates */}
                <div className="bg-white rounded-xl border border-black/8 shadow-sm p-5">
                  <h3 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm mb-3">Next Available</h3>
                  {monthDates
                    .filter((date) => {
                      const s = computeDayStatus(date, overrides);
                      return s === "open" || s === "halfday";
                    })
                    .slice(0, 6)
                    .map((date) => {
                      const s = computeDayStatus(date, overrides);
                      const iso = toISODate(date);
                      return (
                        <button key={iso} onClick={() => setUserPicked(date)}
                          className="w-full flex items-center justify-between py-2.5 border-b border-black/5 last:border-0 hover:bg-[#f5f0ef] px-1 rounded transition-colors">
                          <span className="text-xs font-medium text-[#1E1E1E]">
                            {formatLongDate(date)}
                          </span>
                          <span className={`text-[10px] font-semibold ${
                            s === "open" ? "text-[#16A34A]" : "text-[#D97706]"
                          }`}>
                            {s === "open" ? `${FULL_SLOTS.length} slots` : `${HALF_SLOTS.length} AM slots`}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Client: Profile ─────────────────────────────────────────────────────────

function ClientProfile({ onLogout }: { onLogout: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const { activeCase } = useClientPortal();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setFullName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
    setEditing(true);
  };

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await profileService.update(profile.id, { full_name: fullName, phone: phone || null });
      await refreshProfile();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const details = [
    { label: "Email",   val: profile?.email ?? "—" },
    { label: "Phone",   val: profile?.phone ?? "Not provided" },
    { label: "Case ID", val: activeCase?.reference ?? "No active case" },
    { label: "Service", val: activeCase ? moduleLabel(activeCase.module) : "—" },
    { label: "Joined",  val: profile ? formatDate(profile.created_at) : "—" },
  ];

  return (
    <div className="bg-[#F4F5F7] pb-24 sm:pb-0" style={{ fontFamily:"'Inter',sans-serif", minHeight:"calc(100vh - 56px)" }}>
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-6 sm:py-10">

        {/* Avatar hero — full-width maroon on mobile */}
        <div className="bg-[#8A1C1F] rounded-2xl overflow-hidden mb-4 shadow-sm">
          <div className="px-5 py-7 sm:py-8 flex items-center gap-4 sm:gap-5">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/20 flex items-center justify-center text-white text-2xl sm:text-3xl font-bold shrink-0 border-2 border-white/30">
              {profile?.avatar_initials ?? "—"}
            </div>
            <div>
              <p style={{ fontFamily:"'Cinzel',serif" }} className="text-lg sm:text-xl font-bold text-white leading-tight">
                {profile?.full_name || profile?.email || "Client"}
              </p>
              <p className="text-white/60 text-sm mt-0.5">Client Account</p>
              <div className="mt-2 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${activeCase ? "bg-[#16A34A]" : "bg-white/40"}`} />
                <span className="text-[11px] text-white/60 font-medium">
                  {activeCase ? "Active case" : "No active case"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Details card */}
        <div className="bg-white rounded-2xl border border-black/8 shadow-sm overflow-hidden mb-4">
          <div className="px-5 py-3.5 border-b border-black/6">
            <p className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-widest">Account Details</p>
          </div>
          {editing ? (
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#6b6b6b] uppercase tracking-wide mb-1.5">Full Name</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)}
                  className="w-full border border-black/15 rounded-lg px-3 py-2.5 text-sm bg-[#f5f5f5] outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#6b6b6b] uppercase tracking-wide mb-1.5">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="w-full border border-black/15 rounded-lg px-3 py-2.5 text-sm bg-[#f5f5f5] outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setEditing(false)}
                  className="flex-1 border border-black/15 text-[#344248] text-sm font-semibold py-2.5 rounded-lg hover:bg-[#f0f0f0] transition-colors">
                  Cancel
                </button>
                <button onClick={save} disabled={saving}
                  className="flex-1 bg-[#8A1C1F] text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-[#6d1518] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving && <Loader2 size={14} className="animate-spin" />} Save
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-black/5">
              {details.map((row) => (
                <div key={row.label} className="px-5 py-4 flex justify-between items-center gap-3">
                  <span className="text-xs font-semibold text-[#6b6b6b] uppercase tracking-wide shrink-0">{row.label}</span>
                  <span className="text-sm text-[#1E1E1E] font-medium text-right truncate">{row.val}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {!editing && (
            <button onClick={startEdit}
              className="w-full flex items-center justify-center gap-2 bg-[#344248] text-white py-3.5 rounded-xl font-semibold text-sm hover:bg-[#2a3540] active:opacity-80 transition-all">
              <User size={15} /> Edit Profile
            </button>
          )}
          <button onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 border-2 border-[#DC2626]/25 text-[#DC2626] py-3.5 rounded-xl font-semibold text-sm hover:bg-[#DC2626]/5 active:opacity-80 transition-all">
            <LogOut size={15} /> Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN PORTAL TABS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Admin: Dashboard ────────────────────────────────────────────────────────

function AdminDashboard({ onReview }: { onReview: (c: CaseWithClient) => void }) {
  const { cases, stats, loading, error } = useAdminCases();

  const metricCards = [
    { label:"Total Open Cases",     val: stats.totalOpen,           cls:"bg-white border-black/8",           text:"text-[#1E1E1E]" },
    { label:"Pending Verification", val: stats.pendingVerification, cls:"bg-[#D97706]/8 border-[#D97706]/20", text:"text-[#D97706]" },
    { label:"Missing Requirements", val: stats.missingRequirements, cls:"bg-[#DC2626]/8 border-[#DC2626]/20", text:"text-[#DC2626]" },
    { label:"Daily Completed",      val: stats.dailyCompleted,      cls:"bg-[#16A34A]/8 border-[#16A34A]/20", text:"text-[#16A34A]" },
  ];

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily:"'Inter',sans-serif" }}>
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-2xl font-bold text-[#1E1E1E] mb-1">
          Administration Overview
        </h1>
        <p className="text-sm text-[#6b6b6b] mb-7">Live metrics and operational case queue.</p>

        {error && (
          <div className="mb-6 flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
            <AlertCircle size={13} className="shrink-0" /> {error}
          </div>
        )}

        {/* Metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {metricCards.map((m) => (
            <div key={m.label} className={`rounded-xl border p-5 shadow-sm ${m.cls}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1 ${m.text} opacity-70`}>{m.label}</p>
              <p className={`text-4xl font-black ${m.text}`}>{m.val}</p>
            </div>
          ))}
        </div>

        {/* Worklist table */}
        <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-black/6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-[#344248]" />
              <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">Operational Worklist</h2>
            </div>
            <span className="text-xs text-[#6b6b6b]">{cases.length} active records</span>
          </div>
          {loading ? (
            <Spinner label="Loading cases…" />
          ) : cases.length === 0 ? (
            <EmptyState message="No cases have been submitted yet." />
          ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f5f0ef] text-[10px] font-semibold text-[#344248] uppercase tracking-wider">
                <th className="px-6 py-3 text-left">Case ID</th>
                <th className="px-6 py-3 text-left">Client</th>
                <th className="px-6 py-3 text-left">Module</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">Last Update</th>
                <th className="px-6 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-black/5 hover:bg-[#FDFDFD] transition-colors">
                  <td className="px-6 py-3.5 font-mono text-xs text-[#344248]">{c.reference}</td>
                  <td className="px-6 py-3.5 font-medium text-[#1E1E1E] text-xs">{c.client?.full_name ?? c.client?.email ?? "—"}</td>
                  <td className="px-6 py-3.5 text-xs text-[#6b6b6b]">{moduleLabel(c.module)}</td>
                  <td className="px-6 py-3.5"><StatusBadge status={c.status} /></td>
                  <td className="px-6 py-3.5 text-xs text-[#6b6b6b]">{timeAgo(c.updated_at)}</td>
                  <td className="px-6 py-3.5">
                    <button onClick={() => onReview(c)}
                      className="text-[#8A1C1F] text-xs font-semibold hover:underline flex items-center gap-1">
                      Review <ChevronRight size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Admin: Worklist (full tracker) ──────────────────────────────────────────

function AdminWorklist({ onReview }: { onReview: (c: CaseWithClient) => void }) {
  const { cases, loading, error } = useAdminCases();
  const steps = ["Submitted","Under Review","In Progress","Requirement Verification","Final Sign-off"];

  const topCase = cases[0] ?? null;
  const activeStep = topCase ? Math.max(0, phases.indexOf(topCase.phase)) : 0;
  // A case in the "waiting" state is stalled at its current phase.
  const stalledAt = topCase?.status === "waiting" ? activeStep : steps.length;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily:"'Inter',sans-serif" }}>
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-2xl font-bold text-[#1E1E1E] mb-1">Case Worklist</h1>
        <p className="text-sm text-[#6b6b6b] mb-7">Live case tracking and progress management.</p>

        {error && (
          <div className="mb-6 flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
            <AlertCircle size={13} className="shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <Spinner label="Loading cases…" />
        ) : cases.length === 0 ? (
          <EmptyState message="No cases to track yet." />
        ) : (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {cases.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-black/8 shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-[10px] font-mono text-[#6b6b6b]">{c.reference}</p>
                  <p className="font-semibold text-[#1E1E1E] text-sm">{c.client?.full_name ?? c.client?.email ?? "—"}</p>
                  <p className="text-xs text-[#344248]">{moduleLabel(c.module)}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <p className="text-[10px] text-[#A0A0A0] mb-3">Updated {timeAgo(c.updated_at)}</p>
              <button onClick={() => onReview(c)}
                className="text-xs text-[#8A1C1F] font-semibold hover:underline flex items-center gap-1">
                Review Case Files <ChevronRight size={11} />
              </button>
            </div>
          ))}
        </div>

        {/* Progress stepper for top case */}
        {topCase && (
        <div className="bg-white rounded-xl border border-black/8 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E]">Case Progress — {topCase.reference}</h2>
            <StatusBadge status={topCase.status} />
          </div>
          {topCase.status === "waiting" && (
            <p className="text-xs text-[#DC2626] mb-5 flex items-center gap-1.5">
              <AlertCircle size={12} /> Missing documents — dashed connector marks stalled stage.
            </p>
          )}
          <div className="flex items-center overflow-x-auto pb-2 gap-0">
            {steps.map((step, i) => {
              const done    = i < activeStep;
              const current = i === activeStep;
              const stalled = i >= stalledAt;
              return (
                <div key={step} className="flex items-center shrink-0">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                      done    ? "bg-[#16A34A] border-[#16A34A] text-white" :
                      current ? "bg-[#8A1C1F] border-[#8A1C1F] text-white" :
                      stalled ? "bg-white border-[#DC2626] text-[#DC2626]" :
                                "bg-white border-[#A0A0A0] text-[#A0A0A0]"
                    }`}>
                      {done ? <CheckCircle size={14} /> : i + 1}
                    </div>
                    <span className={`text-[10px] mt-1.5 text-center max-w-[72px] font-medium leading-tight ${
                      done ? "text-[#16A34A]" : current ? "text-[#8A1C1F]" : stalled ? "text-[#DC2626]" : "text-[#A0A0A0]"
                    }`}>{step}</span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`mb-5 mx-1 ${stalled || i >= stalledAt - 1 ? "border-t-2 border-dashed border-[#DC2626] w-10" : `h-0.5 w-10 ${done ? "bg-[#16A34A]" : "bg-[#A0A0A0]/30"}`}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

// ─── Admin: Verify ───────────────────────────────────────────────────────────

function AdminVerify({
  selectedCase, onDone,
}: {
  selectedCase: CaseWithClient | null;
  onDone: () => void;
}) {
  const { profile } = useAuth();
  const [phase, setPhase] = useState<CasePhase>(selectedCase?.phase ?? "Under Review");
  const [note,  setNote]  = useState("");
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [busy, setBusy] = useState<null | "phase" | "dispatch" | "approve" | "reject">(null);
  const [info, setInfo] = useState("");

  useEffect(() => {
    setPhase(selectedCase?.phase ?? "Under Review");
    setNote("");
    setInfo("");
  }, [selectedCase]);

  if (!selectedCase) {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7] flex items-center justify-center" style={{ fontFamily:"'Inter',sans-serif" }}>
        <EmptyState message="Select a case from the Dashboard or Worklist to review it here." />
      </div>
    );
  }

  const clientName = selectedCase.client?.full_name || selectedCase.client?.email || "Client";
  const recipient = channel === "email"
    ? selectedCase.client?.email ?? ""
    : selectedCase.client?.phone ?? "";

  const savePhase = async (next: CasePhase) => {
    setPhase(next);
    setBusy("phase");
    try {
      await casesService.updatePhase(selectedCase.id, next);
      onDone();
    } finally {
      setBusy(null);
    }
  };

  const dispatch = async () => {
    if (!profile || !note.trim() || !recipient) return;
    setBusy("dispatch");
    try {
      await notificationsService.create({
        caseId: selectedCase.id,
        recipient,
        channel,
        message: note.trim(),
        createdBy: profile.id,
      });
      setNote("");
      setInfo("Notification queued for delivery.");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: StatusKey, action: "approve" | "reject") => {
    setBusy(action);
    try {
      await casesService.updateStatus(selectedCase.id, status);
      onDone();
      setInfo(action === "approve" ? "Case marked as approved." : "Case flagged — client action required.");
    } finally {
      setBusy(null);
    }
  };

  const detailRows = [
    { label: "Client", val: clientName },
    { label: "Module", val: moduleLabel(selectedCase.module) },
    { label: "Filed",  val: formatDate(selectedCase.created_at) },
  ];

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7] flex gap-0" style={{ fontFamily:"'Inter',sans-serif" }}>
      {/* Left control — 35% */}
      <div className="w-[35%] bg-white border-r border-black/8 flex flex-col gap-5 p-7 overflow-auto">
        <div>
          <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-xl font-bold text-[#1E1E1E] mb-0.5">Case Verification</h1>
          <p className="text-xs text-[#6b6b6b]">Case {selectedCase.reference} · {clientName}</p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {detailRows.map((r) => (
            <div key={r.label} className="bg-[#F4F5F7] rounded-lg px-3.5 py-2.5 flex justify-between items-center">
              <span className="text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide">{r.label}</span>
              <span className="text-xs font-medium text-[#1E1E1E]">{r.val}</span>
            </div>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">Change Case Phase</label>
          <select value={phase} onChange={(e) => savePhase(e.target.value as CasePhase)} disabled={busy === "phase"}
            className="w-full border border-black/15 rounded-lg px-3 py-2.5 text-sm bg-[#f5f5f5] outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20">
            {phases.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">Notify via</label>
          <div className="flex gap-2">
            {(["email", "sms"] as const).map((ch) => (
              <button key={ch} type="button" onClick={() => setChannel(ch)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${
                  channel === ch ? "border-[#8A1C1F] bg-[#8A1C1F]/5 text-[#8A1C1F]" : "border-black/10 text-[#6b6b6b]"
                }`}>
                {ch === "email" ? "Email" : "SMS"}
              </button>
            ))}
          </div>
          {!recipient && (
            <p className="text-[10px] text-[#D97706] mt-1.5">Client has no {channel} on file.</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">Client Notification</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Type a message to send to the client..."
            rows={5}
            className="w-full border border-black/15 rounded-lg px-3 py-2.5 text-sm bg-[#f5f5f5] outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 resize-none" />
        </div>

        <button onClick={dispatch} disabled={busy === "dispatch" || !note.trim() || !recipient}
          className="flex items-center justify-center gap-2 bg-[#344248] text-white py-3 rounded-lg font-semibold text-sm hover:bg-[#2a3540] transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
          {busy === "dispatch" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          Dispatch Alert Update
        </button>

        {info && (
          <div className="flex items-center gap-2 text-[#16A34A] text-xs bg-[#16A34A]/8 border border-[#16A34A]/20 rounded-lg px-3 py-2.5">
            <CheckCircle size={12} className="shrink-0" /> {info}
          </div>
        )}

        <div className="mt-auto border-t border-black/8 pt-4">
          <p className="text-[10px] text-[#6b6b6b] flex items-center gap-1.5"><Clock size={11} /> Last updated {timeAgo(selectedCase.updated_at)}</p>
        </div>
      </div>

      {/* Right document view — 65% */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b border-black/8 px-6 py-3 flex items-center gap-3">
          <span className="flex-1 text-sm font-medium text-[#344248]">{selectedCase.reference} · {moduleLabel(selectedCase.module)}</span>
          <button onClick={() => setStatus("done", "approve")} disabled={busy === "approve"}
            className="flex items-center gap-1.5 bg-[#16A34A] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#15803d] transition-colors disabled:opacity-60">
            {busy === "approve" ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve & Validate
          </button>
          <button onClick={() => setStatus("waiting", "reject")} disabled={busy === "reject"}
            className="flex items-center gap-1.5 bg-[#8A1C1F] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#6d1518] transition-colors disabled:opacity-60">
            {busy === "reject" ? <Loader2 size={12} className="animate-spin" /> : <Flag size={12} />} Flag / Reject
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-10 bg-[#F4F5F7]">
          <div className="w-full max-w-lg aspect-[3/4] bg-white border border-black/10 rounded-xl shadow-lg flex flex-col items-center justify-start p-10">
            <div className="w-10 h-10 rounded-full bg-[#f5f0ef] flex items-center justify-center mb-3">
              <FileText size={18} className="text-[#8A1C1F]" />
            </div>
            <p style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-base mb-0.5">{moduleLabel(selectedCase.module)}</p>
            <p className="text-xs text-[#6b6b6b] mb-8">{clientName} · {selectedCase.reference}</p>
            <div className="w-full space-y-2.5">
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} className={`h-2 bg-[#e8e8e8] rounded ${i % 4 === 0 ? "w-3/4" : "w-full"}`} />
              ))}
            </div>
            <div className="mt-10 border-t border-black/8 w-full pt-5 flex justify-between">
              <div><div className="h-px w-24 bg-[#1E1E1E] mb-1" /><p className="text-[10px] text-[#6b6b6b]">Client Signature</p></div>
              <div><div className="h-px w-24 bg-[#1E1E1E] mb-1" /><p className="text-[10px] text-[#6b6b6b]">Notary Signature</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Admin: Notifications ────────────────────────────────────────────────────

function AdminNotifications() {
  const { notifications, loading, error } = useNotifications();

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily:"'Inter',sans-serif" }}>
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-2xl font-bold text-[#1E1E1E] mb-1">Notification History</h1>
        <p className="text-sm text-[#6b6b6b] mb-7">Outbound messaging traffic and delivery audit log.</p>

        {error && (
          <div className="mb-6 flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
            <AlertCircle size={13} className="shrink-0" /> {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-black/6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-[#344248]" />
              <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">Dispatch Log</h2>
            </div>
            <span className="text-xs text-[#6b6b6b]">{notifications.length} messages sent</span>
          </div>
          {loading ? (
            <Spinner label="Loading notifications…" />
          ) : notifications.length === 0 ? (
            <EmptyState message="No notifications have been dispatched yet." />
          ) : (
          <div className="divide-y divide-black/5">
            {notifications.map((n) => (
              <div key={n.id} className="px-6 py-4 flex items-start gap-4 hover:bg-[#FDFDFD] transition-colors">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  n.channel === "email" ? "bg-[#344248]/10" : "bg-[#8A1C1F]/8"
                }`}>
                  {n.channel === "email"
                    ? <Mail size={14} className="text-[#344248]" />
                    : <Smartphone size={14} className="text-[#8A1C1F]" />}
                </div>
                <div className="w-40 shrink-0">
                  <p className="text-[10px] font-semibold text-[#344248] uppercase tracking-wide mb-0.5">
                    {n.channel === "email" ? "Email" : "SMS"}
                  </p>
                  <p className="text-[10px] text-[#6b6b6b] break-all">{n.recipient}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1E1E1E] leading-relaxed">{n.message}</p>
                  <p className="text-[10px] text-[#A0A0A0] mt-1">{formatDateTime(n.created_at)}</p>
                </div>
                <span className={`shrink-0 ml-4 inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${
                  n.status === "confirmed" ? "text-[#16A34A]" : "text-[#D97706]"
                }`}>
                  {n.status === "confirmed" ? <CheckCircle size={11} /> : <Clock size={11} />}
                  {n.status === "confirmed" ? "Delivery Confirmed" : "Pending Delivery"}
                </span>
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7]" style={{ fontFamily:"'Inter',sans-serif" }}>
      <div className="flex flex-col items-center gap-3">
        <CrestMark size={64} />
        <Loader2 size={20} className="animate-spin text-[#8A1C1F]" />
      </div>
    </div>
  );
}

export default function App() {
  const { session, role, loading, signOut } = useAuth();
  const [userTab,   setUserTab]   = useState<UserTab>("dashboard");
  const [adminTab,  setAdminTab]  = useState<AdminTab>("dashboard");
  const [reviewCase, setReviewCase] = useState<CaseWithClient | null>(null);
  const { unreadCount } = useNotifications();

  const handleLogout = async () => {
    await signOut();
    setUserTab("dashboard");
    setAdminTab("dashboard");
    setReviewCase(null);
  };

  const openReview = (c: CaseWithClient) => {
    setReviewCase(c);
    setAdminTab("verify");
  };

  if (loading) return <LoadingScreen />;

  if (!session) return <LoginScreen />;

  // Signed in but the profile row (and therefore role) is still resolving.
  if (!role) return <LoadingScreen />;

  if (role === "user") {
    return (
      <div className="min-h-screen bg-[#F4F5F7] sm:pb-0" style={{ paddingBottom: 0 }}>
        <TopNav role="user" tab={userTab} setTab={setUserTab} onLogout={handleLogout} notifCount={unreadCount} />
        {userTab === "dashboard" && <ClientDashboard />}
        {userTab === "history"   && <ClientHistory />}
        {userTab === "schedule"  && <ScheduleView isAdmin={false} />}
        {userTab === "profile"   && <ClientProfile onLogout={handleLogout} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <TopNav role="admin" tab={adminTab} setTab={setAdminTab} onLogout={handleLogout} notifCount={unreadCount} />
      {adminTab === "dashboard"     && <AdminDashboard onReview={openReview} />}
      {adminTab === "worklist"      && <AdminWorklist  onReview={openReview} />}
      {adminTab === "verify"        && <AdminVerify selectedCase={reviewCase} onDone={() => { /* live data refreshes on next open */ }} />}
      {adminTab === "schedule"      && <ScheduleView isAdmin />}
      {adminTab === "notifications" && <AdminNotifications />}
    </div>
  );
}
