import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Scale, Bell, Upload, FileText, CheckCircle, AlertCircle, Clock,
  ChevronRight, Eye, EyeOff, History, Send, Flag, ChevronLeft,
  Mail, Calendar, LayoutDashboard, ShieldCheck,
  LogOut, User, Inbox, X, Loader2, Users, BarChart3, Menu,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { authService } from "@/services/auth.service";
import { profileService } from "@/services/profile.service";
import { casesService } from "@/services/cases.service";
import { documentsService } from "@/services/documents.service";
import { notificationsService } from "@/services/notifications.service";
import { requirementsService } from "@/services/requirements.service";
import { scheduleService } from "@/services/schedule.service";
import { AdminClients } from "@/app/components/admin/AdminClients";
import { AdminReports } from "@/app/components/admin/AdminReports";
import { CaseDocuments } from "@/app/components/admin/CaseDocuments";
import { BrandLockup, CrestMark } from "@/app/components/shared/Brand";
import { NotificationsPanel } from "@/app/components/shared/NotificationsPanel";
import { StatusBadge } from "@/app/components/shared/StatusBadge";
import { EmptyState, Spinner } from "@/app/components/shared/States";
import { useClientPortal } from "@/hooks/useClientPortal";
import { useAdminCases } from "@/hooks/useAdminCases";
import { useNotifications } from "@/hooks/useNotifications";
import { useSchedule } from "@/hooks/useSchedule";
import { formatBytes, formatDate, formatDateTime, moduleLabel, timeAgo } from "@/lib/format";
import { hasSignedInBefore } from "@/lib/visitor";
import { joinPresence, leavePresence } from "@/lib/presence";
import {
  normalizePhone, validateEmail, validateFullName, validatePassword, validatePhone,
} from "@/lib/validation";
import { PasswordStrength } from "@/app/components/shared/PasswordStrength";
import type {
  Appointment, CasePhase, CaseRequirement, CaseWithClient, DeliveryStatus, OverrideType,
  RequirementTemplate, Role, ScheduleOverride, ServiceModule, StatusKey,
} from "@/types/models";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/app/components/ui/sheet";

// ─── Types ───────────────────────────────────────────────────────────────────

type UserTab = "dashboard" | "history" | "schedule" | "profile";
type AdminTab =
  | "dashboard" | "worklist" | "verify" | "clients"
  | "schedule" | "reports" | "notifications";

// ─── UI Configuration (static presentation config, not domain data) ──────────

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/**
 * How each real delivery state is presented in the admin dispatch log.
 *
 * The log used to key off the legacy `status` flag, which is only ever flipped
 * to "confirmed" by a successful provider send. Anything that was skipped or
 * failed therefore displayed as "Pending Delivery" — messages looked stuck in a
 * queue when in reality no email provider was configured for the Edge
 * Function, so nothing was ever going to be sent. Reading `delivery_status`
 * reports what actually happened.
 */
const deliveryConfig: Record<DeliveryStatus, { label: string; tone: string; icon: React.ReactNode }> = {
  queued:  { label: "Queued",        tone: "text-[#D97706]", icon: <Clock       size={11} /> },
  sending: { label: "Sending…",      tone: "text-[#D97706]", icon: <Loader2     size={11} className="animate-spin" /> },
  sent:    { label: "Delivered",     tone: "text-[#16A34A]", icon: <CheckCircle size={11} /> },
  failed:  { label: "Failed",        tone: "text-[#DC2626]", icon: <AlertCircle size={11} /> },
  skipped: { label: "Not sent",      tone: "text-[#6b6b6b]", icon: <X           size={11} /> },
};

const phases: CasePhase[] = [
  "Submitted", "Under Review", "In Progress",
  "Requirement Verification", "Final Sign-off / Execution",
];

// ─── Upload rules (must mirror the storage bucket limits in migration 0005) ──

const MAX_UPLOAD_MB = 10;
const ACCEPTED_EXTENSIONS = ["PDF", "JPG", "PNG"];
const ACCEPTED_ATTR = ".pdf,.jpg,.jpeg,.png";
const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png"];

/** Client-side pre-check so the user is told before the upload round-trip. */
function validateUpload(file: File): string | null {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `"${file.name}" is larger than the ${MAX_UPLOAD_MB} MB limit.`;
  }
  if (file.type && !ACCEPTED_MIME.includes(file.type)) {
    return `"${file.name}" must be a PDF, JPG or PNG file.`;
  }
  return null;
}

/**
 * Finds the seeded checklist row an upload satisfies, so the database can mark
 * the requirement fulfilled and keep the evidence trail.
 */
function matchRequirement(
  requirements: CaseRequirement[],
  keywords: string[],
): string | null {
  const hit = requirements.find((r) =>
    keywords.some((k) => r.name.toLowerCase().includes(k)),
  );
  return hit?.id ?? null;
}

const ID_KEYWORDS  = ["photo id", "government-issued", "valid id", "id of seller"];
const MAIN_DOC_KEYWORDS: Record<ServiceModule, string[]> = {
  notarization: ["notarized", "document to be"],
  deed:         ["tax declaration"],
  ejs:          ["death certificate"],
};

// ─── Shared UI Atoms ─────────────────────────────────────────────────────────

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
  { id: "clients",       label: "Clients",       icon: <Users           size={18} /> },
  { id: "schedule",      label: "Schedule",      icon: <Calendar        size={18} /> },
  { id: "reports",       label: "Reports",       icon: <BarChart3       size={18} /> },
  { id: "notifications", label: "Notifications", icon: <Bell            size={18} /> },
];

/**
 * The notification feed is owned by the root `App` and passed down, so the bell
 * badge and the panel share one source of truth. Running the hook in both places
 * meant two fetches plus two realtime channels, and marking a message read only
 * cleared the badge once the second copy caught up.
 */
type NotificationsApi = ReturnType<typeof useNotifications>;

function TopNav({
  role, tab, setTab, onLogout, notifications: notifApi,
}: {
  role: Role;
  tab: string;
  setTab: (t: any) => void;
  onLogout: () => void;
  notifications: NotificationsApi;
}) {
  const { profile } = useAuth();
  const {
    notifications, loading: loadingNotifs, unreadCount: notifCount,
    markRead, markAllRead, remove,
  } = notifApi;
  const tabs = role === "admin" ? adminTabDefs : userTabDefs;
  const [menuOpen, setMenuOpen] = useState(false);

  const isUser = role === "user";
  const initials = profile?.avatar_initials ?? (role === "admin" ? "AD" : "??");
  const displayName = profile?.full_name ?? (role === "admin" ? "Admin" : "User");
  const activeLabel = tabs.find((t) => t.id === tab)?.label ?? "";

  // Seven admin tabs plus the brand and the account area can overflow a laptop
  // window. The tab strip scrolls horizontally, but with the scrollbar hidden
  // there was no hint that more tabs existed — the client reported a tab that
  // could not be seen or pressed. A soft gradient at the right edge shows when
  // more tabs are reachable.
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const update = () => setTabsOverflow(el.scrollWidth > el.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  /**
   * The bell and its panel, shared by the desktop and mobile bars.
   *
   * Opening the panel deliberately does *not* mark everything read: the client
   * asked for unread messages to stand out in bold until each one is opened,
   * which is impossible if merely looking at the list clears the whole list.
   * "Mark all as read" is offered inside the panel instead.
   */
  const notificationBell = (iconSize: number, badgeClass: string) => (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" aria-label={`Notifications${notifCount > 0 ? `, ${notifCount} unread` : ""}`}
          className="relative text-white/55 hover:text-white transition-colors p-1.5">
          <Bell size={iconSize} />
          {notifCount > 0 && (
            <span className={`absolute w-4 h-4 bg-[#DC2626] rounded-full text-[9px] font-bold text-white flex items-center justify-center ${badgeClass}`}>
              {notifCount > 9 ? "9+" : notifCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right"
        className="w-full sm:max-w-md bg-[#F4F5F7] p-0 border-l border-black/10 overflow-hidden flex flex-col z-50 gap-0">
        <SheetHeader className="px-6 py-5 bg-white border-b border-black/5 shrink-0">
          <SheetTitle style={{ fontFamily: "'Cinzel',serif" }} className="text-lg">Notifications</SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0">
          <NotificationsPanel
            notifications={notifications}
            loading={loadingNotifs}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
            onRemove={remove}
          />
        </div>
      </SheetContent>
    </Sheet>
  );

  const signOutButton = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="text-white/35 hover:text-white transition-colors p-1" title="Sign out">
          <LogOut size={15} />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign Out</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to sign out of your account? You will need to log in again to access your dashboard.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onLogout} className="bg-[#8A1C1F] hover:bg-[#721518] text-white">Sign Out</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <>
      {/* ── Desktop / tablet top bar ─────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-[#1E1E1E] border-b border-white/8 shadow-lg hidden sm:block">
        <div className="max-w-screen-xl mx-auto px-5 flex items-center h-14 gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <CrestMark size={36} light />
            <span style={{ fontFamily:"'Cinzel',serif" }}
              className="text-white text-sm font-bold tracking-wide leading-none hidden 2xl:block">
              Uy-Laurio
            </span>
          </div>

          <div className="h-5 w-px bg-white/15 shrink-0" />

          {/* Tabs */}
          <div className="relative flex-1 min-w-0 self-stretch">
            <div ref={tabsRef}
              onWheel={(e) => {
                // Let a vertical wheel scroll the strip sideways.
                if (e.deltaY !== 0 && tabsRef.current) tabsRef.current.scrollLeft += e.deltaY;
              }}
              className="flex items-end h-full overflow-x-auto tabs-scroll gap-0.5">
              {tabs.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`shrink-0 h-14 flex items-center gap-2 px-2.5 xl:px-4 text-[13px] xl:text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${
                    tab === t.id
                      ? "border-[#8A1C1F] text-white"
                      : "border-transparent text-white/45 hover:text-white/80"
                  }`}>
                  <span className="hidden xl:block">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
            {tabsOverflow && (
              <div aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#1E1E1E] via-[#1E1E1E]/70 to-transparent" />
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3 shrink-0">
            <span className={`hidden lg:inline text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${
              role === "admin" ? "bg-[#8A1C1F]/80 text-white" : "bg-white/10 text-white/55"
            }`}>
              {role === "admin" ? "Admin" : "Client"}
            </span>
            {isUser && notificationBell(17, "-top-0.5 -right-0.5")}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#8A1C1F] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {initials}
              </div>
              <span className="hidden 2xl:block max-w-[150px] truncate text-xs text-white/65 font-medium whitespace-nowrap">
                {displayName}
              </span>
            </div>
            {signOutButton}
          </div>
        </div>
      </header>

      {/* ── Mobile top bar ───────────────────────────────────────────────
          Rendered for both roles. It used to be client-only, which left an
          admin on a phone with no navigation at all: the desktop bar is
          `hidden sm:block` and the bottom tab bar below is client-only, so the
          only way to change section was to widen the window. */}
      <header className="sm:hidden sticky top-0 z-40 bg-[#1E1E1E] border-b border-white/8 shadow-md">
        <div className="flex items-center px-4 gap-2.5" style={{ height: 52 }}>
          <CrestMark size={30} light />
          <div className="flex-1 min-w-0 leading-tight">
            <p style={{ fontFamily:"'Cinzel',serif" }} className="text-white text-sm font-bold truncate">
              Uy-Laurio
            </p>
            {!isUser && activeLabel && (
              <p className="text-[10px] text-white/45 truncate">{activeLabel}</p>
            )}
          </div>

          {isUser && notificationBell(18, "top-0.5 right-0.5")}

          {isUser ? (
            <div className="w-7 h-7 rounded-full bg-[#8A1C1F] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
              {initials}
            </div>
          ) : (
            /* Admin: seven sections do not fit a bottom bar, so they live in a
               drawer that is reachable with one thumb. */
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button type="button" aria-label="Open menu"
                  className="text-white/70 hover:text-white transition-colors p-1.5 -mr-1.5">
                  <Menu size={22} />
                </button>
              </SheetTrigger>
              <SheetContent side="right"
                className="w-[82%] max-w-xs bg-[#1E1E1E] p-0 border-l border-white/10 flex flex-col z-50 gap-0">
                <SheetHeader className="px-5 py-4 border-b border-white/10 shrink-0">
                  <SheetTitle style={{ fontFamily: "'Cinzel',serif" }} className="text-white text-base text-left">
                    Administration
                  </SheetTitle>
                  <p className="text-[11px] text-white/45 text-left truncate">{displayName}</p>
                </SheetHeader>

                <nav className="flex-1 overflow-y-auto py-2">
                  {adminTabDefs.map((t) => (
                    <button key={t.id} type="button"
                      onClick={() => { setTab(t.id); setMenuOpen(false); }}
                      className={`w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium transition-colors border-l-[3px] ${
                        tab === t.id
                          ? "border-[#8A1C1F] bg-white/[0.06] text-white"
                          : "border-transparent text-white/55 hover:text-white hover:bg-white/[0.03]"
                      }`}>
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </nav>

                <div className="border-t border-white/10 p-4 shrink-0">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button type="button"
                        className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-white/70 hover:text-white border border-white/15 rounded-xl py-3 transition-colors">
                        <LogOut size={14} /> Sign out
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Sign Out</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to sign out of your account? You will need to log in again to access your dashboard.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => { setMenuOpen(false); onLogout(); }}
                          className="bg-[#8A1C1F] hover:bg-[#721518] text-white">
                          Sign Out
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </header>

      {/* ── Mobile bottom tab bar (client only — four tabs fit) ────────── */}
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
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

/**
 * Forgot-password dialog. Asks for the address explicitly instead of quietly
 * reusing whatever was typed into the sign-in form, and states up front that the
 * link only lets you choose a new password here on the site.
 */
function PasswordResetDialog({
  open,
  onOpenChange,
  defaultEmail = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEmail?: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  // Re-seed from the sign-in form each time the dialog is opened.
  useEffect(() => {
    if (open) {
      setEmail(defaultEmail);
      setError("");
      setSentTo("");
      setSending(false);
    }
  }, [open, defaultEmail]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const address = email.trim();
    const emailProblem = validateEmail(address);
    if (emailProblem) {
      setError(emailProblem);
      return;
    }
    setSending(true);
    try {
      await authService.requestPasswordReset(address);
      setSentTo(address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-white border border-black/10 rounded-2xl">
        <div className="bg-[#344248] px-6 py-5">
          <DialogTitle style={{ fontFamily: "'Cinzel',serif" }} className="text-white text-lg">
            Reset Password
          </DialogTitle>
          <DialogDescription className="text-white/60 text-xs mt-1">
            We will email you a link to choose a new password.
          </DialogDescription>
        </div>

        {sentTo ? (
          <div className="px-6 py-6 space-y-4">
            <div className="flex items-start gap-2.5 text-[#16A34A] text-sm bg-[#16A34A]/8 border border-[#16A34A]/20 rounded-xl px-3.5 py-3">
              <CheckCircle size={15} className="shrink-0 mt-0.5" />
              <p>Reset link sent to <span className="font-semibold">{sentTo}</span>.</p>
            </div>
            <div className="flex items-start gap-2.5 text-[#D97706] text-xs bg-[#D97706]/8 border border-[#D97706]/20 rounded-xl px-3.5 py-3">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <p>
                If you don’t receive the email, please check your spam or junk folder.
              </p>
            </div>
            <p className="text-xs text-[#6b6b6b] leading-relaxed">
              Opening the link brings you back to this site to set the new password — that is the
              only place the change is made, so the link itself never contains your password.
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="w-full bg-[#8A1C1F] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#6d1518] transition-colors">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="px-6 py-6 space-y-4">
            <div>
              <label htmlFor="reset-email" className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">
                Email address
              </label>
              <input
                id="reset-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@email.com"
                autoComplete="email"
                autoFocus
                className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all" />
            </div>

            <div className="flex items-start gap-2.5 text-[#6b6b6b] text-xs bg-[#F4F5F7] border border-black/8 rounded-xl px-3.5 py-3">
              <Mail size={14} className="shrink-0 mt-0.5" />
              <p>
                If you don’t receive the email, please check your spam or junk folder.
                If you normally sign in with Google, reset your password through your Google
                account instead.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
                <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={sending}
              className="w-full bg-[#8A1C1F] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#6d1518] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {sending && <Loader2 size={15} className="animate-spin" />}
              Send Reset Link
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One-shot notice flag: set after a password reset so the login screen can
 *  confirm that the new password is now active. */
const PW_UPDATED_FLAG = "uy-laurio:pw-updated";

/**
 * Supabase returns one generic "Invalid login credentials" for several very
 * different situations, which is why a client whose Google sign-in works can be
 * told their correct password is wrong: an account created through Google has no
 * password identity until one is set. Map the raw error onto guidance that names
 * the real causes.
 */
function describeAuthError(err: unknown): { message: string; offerResend: boolean } {
  const raw = err instanceof Error ? err.message : "";
  const text = raw.toLowerCase();

  if (text.includes("not confirmed")) {
    return {
      message:
        "This email has not been confirmed yet. Open the confirmation link we emailed you, then sign in.",
      offerResend: true,
    };
  }
  if (text.includes("invalid login credentials")) {
    return {
      message:
        "Incorrect email or password. If you usually sign in with Google, use \u201CContinue with Google\u201D " +
        "instead — Google accounts have no portal password until one is set. Otherwise, use " +
        "\u201CForgot password?\u201D to set or reset your password.",
      offerResend: true,
    };
  }
  if (text.includes("email rate limit") || text.includes("rate limit")) {
    return {
      message:
        "Too many email requests for now. Wait a few minutes before trying again.",
      offerResend: false,
    };
  }
  return {
    message: raw || "Authentication failed. Please try again.",
    offerResend: false,
  };
}

function LoginScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone,    setPhone]    = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [error,    setError]    = useState("");
  const [info,     setInfo]     = useState("");
  const [loading,  setLoading]  = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  /** Shown when the failure looks like an unconfirmed address. */
  const [offerResend, setOfferResend] = useState(false);
  /**
   * Read once on mount: a brand-new visitor should not be greeted with
   * "Welcome Back". Kept in state so the heading cannot change mid-session.
   */
  const [returningVisitor] = useState(hasSignedInBefore);

  const isSignup = mode === "signup";

  /** Handle return from email confirmation link */
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Arriving fresh after a completed password reset: confirm it visibly so
    // the client knows the change persisted before typing anything.
    if (sessionStorage.getItem(PW_UPDATED_FLAG) === "1") {
      sessionStorage.removeItem(PW_UPDATED_FLAG);
      setInfo("Your password has been updated. Sign in with your new password.");
    }

    const hashString = window.location.hash.replace(/^#/, "");
    const hashParams = new URLSearchParams(hashString);
    const searchParams = new URLSearchParams(window.location.search);

    const errorDesc = hashParams.get("error_description") || searchParams.get("error_description");
    const errorCode = hashParams.get("error_code") || searchParams.get("error_code");
    const errorParam = hashParams.get("error") || searchParams.get("error");
    const type = hashParams.get("type") || searchParams.get("type");

    if (errorCode === "otp_expired" || (errorDesc && errorDesc.toLowerCase().includes("expired"))) {
      setInfo(
        "Notice: Your email verification link was already used or your account is already verified. Please sign in below with your email and password.",
      );
      setMode("signin");
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (errorDesc || errorParam) {
      setError(
        errorDesc
          ? decodeURIComponent(errorDesc).replace(/\+/g, " ")
          : "The confirmation link could not be verified. If your account was already registered, you may try signing in below.",
      );
      setMode("signin");
      setOfferResend(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (type === "signup") {
      setInfo("Your email has been confirmed! Please sign in with your email and password.");
      setMode("signin");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  /**
   * Switching between the two forms clears everything. Previously the email and
   * password typed into Sign In stayed put, so Create Account looked pre-filled
   * with credentials for an account that did not exist yet.
   */
  const switchMode = (next: "signin" | "signup") => {
    setMode(next);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setFullName("");
    setPhone("");
    setShowPass(false);
    setShowConfirmPass(false);
    setError("");
    setInfo("");
    setOfferResend(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setOfferResend(false);
    // Format checks first, with plain messages, so junk addresses never reach
    // the auth server (the form is noValidate to keep these in one voice).
    const emailProblem = validateEmail(email);
    if (emailProblem) {
      setError(isSignup ? emailProblem : "Input a valid email address.");
      return;
    }
    if (!isSignup && !password) {
      setError("Enter your password.");
      return;
    }
    if (isSignup) {
      const problem =
        validateFullName(fullName) ??
        validatePhone(phone) ??
        validatePassword(password);
      if (problem) {
        setError(problem);
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match. Please ensure both passwords match.");
        return;
      }
    }
    setLoading(true);
    try {
      if (isSignup) {
        const { session, user } = await authService.signUp({
          email, password, fullName,
          phone: phone.trim() ? normalizePhone(phone) ?? undefined : undefined,
        });

        // Signing up with an address that already exists is not an error for
        // Supabase — it returns a user carrying no identities so that accounts
        // cannot be enumerated. Without this check the UI claims the account
        // was created and the client is then told their credentials are invalid.
        if (user && Array.isArray(user.identities) && user.identities.length === 0) {
          setError(
            "That email is already registered. Sign in instead, or use \u201CForgot password?\u201D " +
            "to set a new password.",
          );
          return;
        }

        // With email confirmation switched off Supabase returns a session and
        // the AuthProvider routes straight into the portal.
        if (session) return;

        setInfo(
          `Account created. We sent a confirmation link to ${email.trim()} — open it, then sign in. ` +
          "If you don’t receive the email, please check your spam or junk folder.",
        );
        setMode("signin");
        setPassword("");
        setConfirmPassword("");
        setFullName("");
        setPhone("");
        setOfferResend(true);
      } else {
        await authService.signInWithPassword(email, password);
      }
      // On success the AuthProvider's listener updates the session and the app
      // routes to the correct portal automatically.
    } catch (err) {
      const described = describeAuthError(err);
      setError(described.message);
      setOfferResend(described.offerResend && email.trim().length > 0);
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

  const handleResend = async () => {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      await authService.resendVerification(email);
      setInfo(
        `Confirmation link sent again to ${email.trim()}. ` +
        "If it has not arrived within a few minutes, check your spam or junk folder.",
      );
    } catch (err) {
      setError(describeAuthError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ fontFamily:"'Poppins',sans-serif" }}>
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
          <CrestMark size={38} light />
          <span style={{ fontFamily:"'Cinzel',serif" }} className="text-white font-bold text-sm tracking-wide">
            Uy-Laurio Legal
          </span>
        </div>

        {/* Center content */}
        <div className="relative z-10 flex flex-col items-center text-center">
          <BrandLockup width={260} light />
          <p className="text-white/40 text-xs leading-relaxed max-w-[240px] mx-auto mt-7">
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
          <div className="md:hidden mb-8 flex flex-col items-center">
            <BrandLockup width={168} />
          </div>

          <h1 style={{ fontFamily:"'Cinzel',serif" }}
            className="text-2xl sm:text-3xl font-bold text-[#1E1E1E] mb-1 text-center">
            {isSignup
              ? "Create An Account"
              : returningVisitor
                ? "Welcome Back"
                : "Welcome to Uy-Laurio Law Office Portal"}
          </h1>
          <p className="text-[#6b6b6b] text-sm mb-8 text-center">
            {isSignup
              ? "Register to start tracking your legal services and documents."
              : returningVisitor
                ? "Sign in to access your portal."
                : "Sign in to get started, or create an account below."}
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

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {isSignup && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">
                    Full Name <span className="text-[#DC2626]">*</span>
                  </label>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan Dela Cruz Santos" autoComplete="name"
                    className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all" />
                  <p className="text-[10px] text-[#A0A0A0] mt-1">Your full legal name is required: first and last name, plus middle name if any (e.g., Juan Dela Cruz Santos).</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">
                    Phone <span className="text-[#A0A0A0] font-normal">(optional)</span>
                  </label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)}
                    placeholder="+639XXXXXXXXX" autoComplete="tel" inputMode="tel"
                    className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all" />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">
                Email {isSignup && <span className="text-[#DC2626]">*</span>}
              </label>
              <input value={email} onChange={(e) => setEmail(e.target.value)}
                type="email" placeholder="you@email.com"
                autoComplete="email"
                className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all" />
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="block text-sm font-semibold text-[#1E1E1E]">
                  Password {isSignup && <span className="text-[#DC2626]">*</span>}
                </label>
                {!isSignup && (
                  <button type="button" onClick={() => setResetOpen(true)}
                    className="text-xs font-semibold text-[#8A1C1F] hover:underline">
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input value={password} onChange={(e) => setPassword(e.target.value)}
                  type={showPass ? "text" : "password"} placeholder="Enter password"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all pr-12" />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#6b6b6b] hover:text-[#1E1E1E]">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {isSignup && <PasswordStrength password={password} />}
            </div>

            {isSignup && (
              <div>
                <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">
                  Confirm Password <span className="text-[#DC2626]">*</span>
                </label>
                <div className="relative">
                  <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    type={showConfirmPass ? "text" : "password"} placeholder="Confirm your password"
                    autoComplete="new-password"
                    className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all pr-12" />
                  <button type="button" onClick={() => setShowConfirmPass(!showConfirmPass)}
                    aria-label={showConfirmPass ? "Hide confirm password" : "Show confirm password"}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#6b6b6b] hover:text-[#1E1E1E]">
                    {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-[11px] text-[#DC2626] mt-1.5 font-medium">
                    Passwords do not match.
                  </p>
                )}
                {confirmPassword && password === confirmPassword && (
                  <p className="text-[11px] text-[#16A34A] mt-1.5 font-medium flex items-center gap-1">
                    <CheckCircle size={12} /> Passwords match
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3 leading-relaxed">
                <AlertCircle size={13} className="shrink-0 mt-0.5" /> <span>{error}</span>
              </div>
            )}
            {info && (
              <div className="flex items-start gap-2 text-[#16A34A] text-xs bg-[#16A34A]/8 border border-[#16A34A]/20 rounded-xl px-3.5 py-3 leading-relaxed">
                <CheckCircle size={13} className="shrink-0 mt-0.5" /> <span>{info}</span>
              </div>
            )}
            {offerResend && !isSignup && (
              <button type="button" onClick={handleResend} disabled={loading}
                className="w-full border border-[#8A1C1F]/30 text-[#8A1C1F] py-2.5 rounded-xl font-semibold text-xs hover:bg-[#8A1C1F]/5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                <Send size={13} /> Resend confirmation email
              </button>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-[#8A1C1F] text-white py-3.5 rounded-xl font-semibold text-sm hover:bg-[#6d1518] active:scale-[0.99] transition-all mt-1 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading && <Loader2 size={15} className="animate-spin" />}
              {isSignup ? "Create An Account" : "Sign In"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#6b6b6b]">
            {isSignup ? "Already have an account?" : "New to Uy-Laurio?"}{" "}
            <button
              type="button"
              onClick={() => switchMode(isSignup ? "signin" : "signup")}
              className="text-[#8A1C1F] font-semibold hover:underline">
              {isSignup ? "Sign in" : "Create An Account"}
            </button>
          </p>

          <p className="mt-6 text-center text-xs text-[#A0A0A0]">
            By continuing you agree to our{" "}
            <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="text-[#8A1C1F] hover:underline font-medium">Terms of Service</a>
            {" "}and{" "}
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-[#8A1C1F] hover:underline font-medium">Privacy Policy</a>.
          </p>
        </div>
      </div>

      <PasswordResetDialog open={resetOpen} onOpenChange={setResetOpen} defaultEmail={email} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL TABS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Client: Dashboard ───────────────────────────────────────────────────────

// ─── EJS Requirements Modal ──────────────────────────────────────────────────

function EJSModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) {
  const { profile } = useAuth();
  const [optionalUpload, setOptionalUpload] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [templates, setTemplates] = useState<RequirementTemplate[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const refInputRef = useRef<HTMLInputElement>(null);

  // The checklist is office-maintained data, not a hard-coded list.
  useEffect(() => {
    let active = true;
    requirementsService
      .listTemplates()
      .then((rows) => {
        if (!active) return;
        setTemplates(
          rows.filter((t) => t.active && t.module === "ejs"),
        );
      })
      .catch(() => setTemplates([]))
      .finally(() => active && setLoadingList(false));
    return () => {
      active = false;
    };
  }, []);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const picked = Array.from(incoming);
    for (const f of picked) {
      const problem = validateUpload(f);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError("");
    setFiles((prev) => [...prev, ...picked]);
  };

  const proceed = async () => {
    if (!profile) return;
    setError("");
    setSubmitting(true);
    let createdId: string | null = null;
    try {
      const created = await casesService.create({
        clientId: profile.id,
        module: "ejs",
        moduleDetail: "Extra-Judicial Settlement — originals to be presented in person",
      });
      createdId = created.id;

      // Optional reference photos: filed against the case, not a checklist item.
      for (const file of files) {
        await documentsService.upload({ file, caseId: created.id, ownerId: profile.id });
      }
      onSubmitted();
      onClose();
    } catch (err) {
      if (createdId) {
        await casesService
          .cancel(createdId, "Submission incomplete — upload failed.")
          .catch(() => undefined);
      }
      setError(err instanceof Error ? err.message : "Could not file the request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(30,30,30,0.55)", backdropFilter: "blur(4px)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        style={{ fontFamily: "'Poppins',sans-serif" }}>
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
              {loadingList ? (
                <Spinner label="Loading checklist…" />
              ) : templates.length === 0 ? (
                <EmptyState message="No requirements are configured for this service yet." />
              ) : (
                templates.map((r, i) => (
                  <div key={r.id} className="flex items-start gap-3 px-4 py-3 bg-white hover:bg-[#f5f5f5] transition-colors">
                    <div className="w-5 h-5 rounded-full border-2 border-[#344248]/30 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] font-bold text-[#344248]/60">{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#1E1E1E] leading-tight">{r.name}</p>
                      <p className="text-[10px] text-[#6b6b6b] mt-0.5">{r.note ?? "Bring the original document."}</p>
                    </div>
                  </div>
                ))
              )}
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
                onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
                <div className={`border-2 border-dashed rounded-xl py-8 flex flex-col items-center text-center transition-all ${
                  dragging ? "border-[#344248] bg-[#344248]/8" : "border-[#344248]/25 bg-[#344248]/3"
                }`}>
                  <Upload size={18} className="text-[#344248] mb-2" />
                  <p className="text-xs font-semibold text-[#344248] mb-0.5">Drop files here or browse</p>
                  <p className="text-[10px] text-[#6b6b6b]">
                    JPG, PNG or PDF · Max {MAX_UPLOAD_MB} MB each · For reference only
                  </p>
                  <button type="button" onClick={() => refInputRef.current?.click()}
                    className="mt-3 text-[10px] font-semibold bg-[#344248] text-white px-4 py-1.5 rounded-lg hover:bg-[#2a3540] transition-colors">
                    Browse Files
                  </button>
                  <input ref={refInputRef} type="file" hidden multiple accept={ACCEPTED_ATTR}
                    onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                </div>

                {files.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {files.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center gap-2 bg-[#f5f5f5] rounded-lg px-3 py-2">
                        <FileText size={12} className="text-[#344248] shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-[10px] text-[#1E1E1E]">{f.name}</span>
                        <span className="text-[10px] text-[#6b6b6b] shrink-0">{formatBytes(f.size)}</span>
                        <button type="button" aria-label={`Remove ${f.name}`}
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-[#6b6b6b] hover:text-[#DC2626] transition-colors shrink-0">
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-3 flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
                <AlertCircle size={13} className="shrink-0" /> {error}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-black/8 flex gap-3 shrink-0 bg-[#FDFDFD]">
          <button onClick={onClose} disabled={submitting}
            className="flex-1 border border-black/15 text-[#344248] text-sm font-semibold py-2.5 rounded-lg hover:bg-[#f0f0f0] transition-colors disabled:opacity-60">
            Close
          </button>
          <button onClick={proceed} disabled={submitting}
            className="flex-1 bg-[#8A1C1F] text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-[#6d1518] transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
            {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {submitting ? "Filing request…" : "I Understand — Proceed"}
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
      <input ref={ref} type="file" hidden accept={ACCEPTED_ATTR}
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

function NotarizationPicker({
  selected, onSelect, otherText, onOtherText,
}: {
  selected: string;
  onSelect: (id: string) => void;
  otherText: string;
  onOtherText: (value: string) => void;
}) {
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
              <input value={otherText} onChange={(e) => onOtherText(e.target.value)}
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
  const [notarizeOther, setNotarizeOther] = useState("");
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
    setSelected(null); setNotarizeSub("contract"); setNotarizeOther(""); setStep("select");
    setIdFront(null); setIdBack(null); setDocFile(null); setError("");
  };

  /** Free-text detail stored on the case, including the "Other" description. */
  const moduleDetail = (): string | null => {
    if (selected !== "notarization") return "Deed of Sale preparation and verification";
    const label = notarizationTypes.find((t) => t.id === notarizeSub)?.label ?? null;
    if (notarizeSub !== "other") return label;
    const detail = notarizeOther.trim();
    return detail ? `Other — ${detail}` : "Other (unspecified)";
  };

  const handleSubmit = async () => {
    if (!profile || !selected || selected === "ejs") return;
    if (!idFront || !idBack) { setError("Both sides of a valid government ID are required."); return; }
    if (!docFile) {
      setError(selected === "deed" ? "Please attach the updated tax declaration." : "Please attach the signed document.");
      return;
    }
    if (selected === "notarization" && notarizeSub === "other" && !notarizeOther.trim()) {
      setError("Please describe the document type you need notarized.");
      return;
    }

    for (const file of [idFront, idBack, docFile]) {
      const problem = validateUpload(file);
      if (problem) { setError(problem); return; }
    }

    setError("");
    setSubmitting(true);
    let createdId: string | null = null;
    try {
      const created = await casesService.create({
        clientId: profile.id,
        module: selected as ServiceModule,
        moduleDetail: moduleDetail(),
      });
      createdId = created.id;

      // The database seeded this case's checklist; link each upload to the item
      // it satisfies so the requirement is marked fulfilled server-side.
      const requirements = await requirementsService.listForCase(created.id);
      const idRequirement = matchRequirement(requirements, ID_KEYWORDS);
      const docRequirement = matchRequirement(
        requirements,
        MAIN_DOC_KEYWORDS[selected as ServiceModule],
      );

      const queue: { file: File; requirementId: string | null }[] = [
        { file: idFront, requirementId: idRequirement },
        { file: idBack,  requirementId: idRequirement },
        { file: docFile, requirementId: docRequirement },
      ];
      for (const item of queue) {
        await documentsService.upload({
          file: item.file,
          caseId: created.id,
          ownerId: profile.id,
          requirementId: item.requirementId,
        });
      }

      resetForm();
      onSubmitted();
    } catch (err) {
      // Never leave a case behind with no documents attached to it.
      if (createdId) {
        await casesService
          .cancel(createdId, "Submission incomplete — upload failed.")
          .catch(() => undefined);
      }
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
              <p className="text-xs font-semibold text-[#1E1E1E]">
                {selected === "deed" ? "ID of Seller/s and Buyer/s" : "Valid Government-Issued ID"}
              </p>
            </div>
            <div className="flex gap-3">
              <IDUploadSlot label="Front of ID" sub="Tap to upload front" file={idFront}
                onFile={(f) => {
                  const problem = validateUpload(f);
                  if (problem) { setError(problem); return; }
                  setError(""); setIdFront(f);
                }} />
              <IDUploadSlot label="Back of ID"  sub="Tap to upload back"  file={idBack}
                onFile={(f) => {
                  const problem = validateUpload(f);
                  if (problem) { setError(problem); return; }
                  setError(""); setIdBack(f);
                }} />
            </div>
            <p className="text-[10px] text-[#6b6b6b] mt-2 flex items-center gap-1">
              <AlertCircle size={10} className="text-[#DC2626]" />
              Both sides of your valid government ID are mandatory for all services.
            </p>
          </div>

          {/* Document upload */}
          <div>
            <p className="text-xs font-semibold text-[#1E1E1E] mb-3">
              {selected === "deed" ? "Updated Tax Declaration" : "Signed Document"}
            </p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (!f) return;
                const problem = validateUpload(f);
                if (problem) { setError(problem); return; }
                setError("");
                setDocFile(f);
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
                {docFile
                  ? "Click to replace the selected file."
                  : selected === "deed"
                    ? "Upload a clear photo or scan of the latest tax declaration. Title and SPA (if any) can be added later from your dashboard."
                    : "Upload original, fully signed document in black or blue ink."}
              </p>
              <span className="mt-4 bg-[#344248] text-white text-xs font-semibold px-5 py-2 rounded-lg hover:bg-[#2a3540] transition-colors">
                Browse Files
              </span>
              <input ref={docInputRef} type="file" hidden accept={ACCEPTED_ATTR}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    const problem = validateUpload(f);
                    if (problem) { setError(problem); return; }
                    setError("");
                    setDocFile(f);
                  }
                  e.target.value = "";
                }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ACCEPTED_EXTENSIONS.map((ext) => (
                <span key={ext} className="text-[10px] font-semibold bg-[#f5f0ef] text-[#8A1C1F] px-2 py-0.5 rounded-full">.{ext}</span>
              ))}
              <span className="text-[10px] text-[#6b6b6b] self-center">· Max {MAX_UPLOAD_MB} MB</span>
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
                <NotarizationPicker selected={notarizeSub} onSelect={setNotarizeSub}
                  otherText={notarizeOther} onOtherText={setNotarizeOther} />
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
  const { profile, isFirstSession } = useAuth();
  const {
    activeCase, documents, requirements, loading, error, reload, toggleRequirement,
  } = useClientPortal();
  const [ejsModal, setEjsModal] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const { appointments, reload: reloadSchedule } = useSchedule();

  // Existing booking, surfaced on the dashboard so the client can see (and
  // cancel) it without opening the Schedule tab.
  const todayISO = toISODate(new Date());
  const myAppointment = appointments.find(
    (a) => a.status === "booked" && a.client_id === profile?.id && a.appointment_date >= todayISO,
  ) ?? null;

  const total     = requirements.length;
  const done      = requirements.filter((r) => r.fulfilled).length;
  const remaining = total - done;
  const pct       = total ? Math.round((done / total) * 100) : 0;
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "there";
  const recent    = documents.slice(0, 4);

  const uploadForRequirement = async (reqId: string, file: File) => {
    const target = requirements.find((r) => r.id === reqId);
    if (!target || !profile) return;
    setUploadingId(reqId);
    try {
      // Linking the upload to its checklist item lets the database mark the
      // requirement fulfilled and keep the evidence trail.
      await documentsService.upload({
        file,
        caseId: target.case_id,
        ownerId: profile.id,
        requirementId: reqId,
      });
      await reload();
    } catch {
      /* surfaced via portal error on reload */
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="bg-[#F4F5F7] pb-20 sm:pb-0" style={{ fontFamily:"'Poppins',sans-serif", minHeight:"calc(100vh - 56px)" }}>
      {ejsModal && <EJSModal onClose={() => setEjsModal(false)} onSubmitted={reload} />}

      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {/* Greeting */}
        <div className="mb-5 sm:mb-7 flex items-start justify-between gap-4">
          <div>
            <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-xl sm:text-2xl font-bold text-[#1E1E1E] mb-0.5">
              {isFirstSession
                ? "Welcome to Uy-Laurio Law Office Portal"
                : `Welcome back, ${firstName}.`}
            </h1>
            {isFirstSession ? (
              <p className="text-sm text-[#6b6b6b]">
                Glad to have you here, {firstName}. Choose a service below to start your first submission.
              </p>
            ) : (
              <p className="text-sm text-[#6b6b6b]">
                <span className="text-[#DC2626] font-semibold">{remaining} pending</span>
                {" "}· <span className="text-[#D97706] font-semibold">
                  {requirements.filter((r) => r.urgent && !r.fulfilled).length} action required
                </span>
              </p>
            )}
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

        {myAppointment && (
          <div className="mb-5 sm:mb-6">
            <MyAppointmentCard appointment={myAppointment} onChanged={reloadSchedule} />
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
    <div className="bg-[#F4F5F7] pb-20 sm:pb-0" style={{ fontFamily:"'Poppins',sans-serif", minHeight:"calc(100vh - 56px)" }}>
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

type DayStatus = "open" | "halfday" | "custom" | "closed" | "sunday";

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
    return ov.type === "custom" ? "custom" : "halfday";
  }
  if (dow === 6) return "halfday";                      // Saturday → half-day
  return "open";
}

// Fallbacks only — live slot labels come from the office_time_slots table via
// useSchedule(), so the office can change availability without a deploy.
const FULL_SLOTS = ["9:00 AM","10:00 AM","11:00 AM","1:00 PM","2:00 PM","3:00 PM","4:00 PM"];
const HALF_SLOTS = ["9:00 AM","10:00 AM","11:00 AM"];

/** "9:00 AM" -> minutes since midnight (-1 when malformed). */
function slotMinutes(label: string): number {
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(label);
  if (!m) return -1;
  return (Number(m[1]) % 12 + (m[3] === "PM" ? 12 : 0)) * 60 + Number(m[2]);
}

function minutesLabel(total: number): string {
  const h24 = Math.floor(total / 60);
  return `${h24 % 12 || 12}:${String(total % 60).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}

/** "07:00" / "07:00:00" -> minutes since midnight. */
function clockMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

/** "07:00" -> "7:00 AM" for display. */
function clockLabel(t: string): string {
  return minutesLabel(clockMinutes(t));
}

/** One-hour slots that fit entirely inside a custom override's open hours. */
function customSlots(ov?: ScheduleOverride): string[] {
  if (!ov?.open_time || !ov.close_time) return [];
  const slots: string[] = [];
  for (let t = clockMinutes(ov.open_time); t + 60 <= clockMinutes(ov.close_time); t += 60) {
    slots.push(minutesLabel(t));
  }
  return slots;
}

function daySlots(
  status: DayStatus,
  full = FULL_SLOTS,
  half = HALF_SLOTS,
  override?: ScheduleOverride,
): string[] {
  if (status === "open") return full;
  if (status === "halfday") return half;
  if (status === "custom") return customSlots(override);
  return [];
}

const isOperating = (status: DayStatus) =>
  status === "open" || status === "halfday" || status === "custom";

/** Slots that can no longer be booked because that time has already passed. */
function pastSlotsFor(date: Date, slots: string[], now = new Date()): string[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date < today) return slots;
  if (toISODate(date) !== toISODate(today)) return [];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return slots.filter((slot) => slotMinutes(slot) <= nowMinutes);
}

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const STATUS_STYLE: Record<DayStatus, { cell: string; text: string; badge: string; badgeText: string }> = {
  open:    { cell: "hover:bg-[#f5f0ef] cursor-pointer",  text: "text-[#1E1E1E]",        badge: "",                            badgeText: "" },
  halfday: { cell: "bg-[#D97706]/8 cursor-pointer",       text: "text-[#D97706] font-bold", badge: "bg-[#D97706]/20 text-[#D97706]", badgeText: "Half-day" },
  closed:  { cell: "bg-[#DC2626]/8 cursor-not-allowed",   text: "text-[#DC2626]",        badge: "bg-[#DC2626]/15 text-[#DC2626]", badgeText: "Closed" },
  custom:  { cell: "bg-[#2563EB]/8 cursor-pointer",        text: "text-[#2563EB] font-bold", badge: "bg-[#2563EB]/15 text-[#2563EB]", badgeText: "Custom" },
  sunday:  { cell: "bg-[#f0f0f0] cursor-not-allowed opacity-60", text: "text-[#A0A0A0]", badge: "bg-[#A0A0A0]/15 text-[#A0A0A0]", badgeText: "Closed" },
};

function formatLongDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

// ─── Time Slot Panel (user side) ─────────────────────────────────────────────

function TimeSlotPanel({
  date, status, takenSlots, onBook, onClose, fullSlots, halfSlots, override,
}: {
  date: Date;
  status: DayStatus;
  takenSlots: string[];
  onBook: (slot: string) => Promise<void>;
  onClose: () => void;
  fullSlots?: string[];
  halfSlots?: string[];
  override?: ScheduleOverride;
}) {
  const [booked, setBooked] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const slots = daySlots(status, fullSlots, halfSlots, override);
  const isHalf = status === "halfday";
  const isCustom = status === "custom" && !!override?.open_time && !!override?.close_time;
  const freeCount = slots.filter((s) => !takenSlots.includes(s)).length;

  const confirm = async () => {
    if (!booked) return;
    setSubmitting(true);
    setError("");
    try {
      await onBook(booked);
      onClose();
    } catch (err) {
      // The database enforces one live booking per (date, slot), so a slot can
      // disappear between rendering and confirming if someone else takes it.
      const raw = err instanceof Error ? err.message : "";
      setError(
        /duplicate key|already exists|unique/i.test(raw)
          ? "That slot was just taken by someone else. Please choose another time."
          : raw || "Could not book that slot. Please try again.",
      );
      setBooked(null);
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

      {isCustom && (
        <div className="mx-4 mt-4 bg-[#2563EB]/10 border border-[#2563EB]/25 rounded-lg px-3.5 py-2.5 flex gap-2">
          <Clock size={12} className="text-[#2563EB] shrink-0 mt-0.5" />
          <p className="text-[10px] text-[#2563EB] font-medium leading-relaxed">
            Special hours on this date: {clockLabel(override!.open_time!)} – {clockLabel(override!.close_time!)}.
          </p>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-[10px] font-semibold text-[#344248] uppercase tracking-widest">
            Available Time Slots
          </p>
          <span className={`text-[10px] font-semibold ${freeCount ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
            {freeCount ? `${freeCount} of ${slots.length} free` : "No slots left"}
          </span>
        </div>

        {freeCount === 0 && (
          <div className="mb-3 flex items-start gap-2 text-[#DC2626] text-[11px] bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-lg px-3 py-2.5 leading-relaxed">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <p>No bookable slots are left on this date. Please pick another date, or visit as a walk-in during office hours.</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {slots.map((slot) => {
            const taken = takenSlots.includes(slot);
            return (
              <button key={slot} disabled={taken}
                onClick={() => setBooked(booked === slot ? null : slot)}
                title={taken ? "Not available" : undefined}
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

        {error && (
          <div className="mt-3 flex items-start gap-2 text-[#DC2626] text-[11px] bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-lg px-3 py-2.5 leading-relaxed">
            <AlertCircle size={13} className="shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        <button onClick={confirm} disabled={!booked || submitting}
          className={`mt-4 w-full py-3 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
            booked && !submitting
              ? "bg-[#8A1C1F] text-white hover:bg-[#6d1518]" 
              : "bg-[#f0f0f0] text-[#A0A0A0] cursor-not-allowed"
          }`}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : (booked ? <CheckCircle size={14} /> : null)} 
          {booked ? `Confirm — ${booked}` : "Select a time slot"}
        </button>
      </div>

      <div className="px-4 pb-4">
        <p className="text-[10px] text-[#6b6b6b] leading-relaxed border-t border-black/6 pt-3">
          Walk-in appointments are welcome during office hours. For complex matters, please book in advance.
        </p>
      </div>
    </div>
  );
}

// ─── Appointment cards ───────────────────────────────────────────────────────

/** The client's own upcoming booking, with a confirmed cancel option. */
function MyAppointmentCard({
  appointment, onChanged,
}: {
  appointment: Appointment;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cancel = async () => {
    setBusy(true);
    setError("");
    try {
      await scheduleService.cancel(appointment.id, "Cancelled by client");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the appointment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-[#16A34A]/25 shadow-sm overflow-hidden">
      <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#16A34A]/10 flex items-center justify-center shrink-0">
          <Calendar size={18} className="text-[#16A34A]" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <p className="text-[10px] font-semibold text-[#16A34A] uppercase tracking-widest">Your Appointment</p>
          <p style={{ fontFamily:"'Cinzel',serif" }} className="text-sm font-bold text-[#1E1E1E] leading-tight mt-0.5">
            {formatLongDate(parseISODate(appointment.appointment_date))} · {appointment.time_slot}
          </p>
          <p className="text-[11px] text-[#6b6b6b] mt-0.5">
            {appointment.case ? `${moduleLabel(appointment.case.module)} · ${appointment.case.reference}` : "Consultation"}
            {" "}· Booked
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button type="button" disabled={busy}
              className="text-xs font-semibold text-[#DC2626] border border-[#DC2626]/30 px-3.5 py-2 rounded-lg hover:bg-[#DC2626]/5 transition-colors disabled:opacity-60 flex items-center gap-1.5">
              {busy && <Loader2 size={12} className="animate-spin" />} Cancel Booking
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this appointment?</AlertDialogTitle>
              <AlertDialogDescription>
                Your slot on {formatLongDate(parseISODate(appointment.appointment_date))} at {appointment.time_slot} will be
                released for other clients. You can book a new appointment afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Appointment</AlertDialogCancel>
              <AlertDialogAction onClick={() => void cancel()} className="bg-[#8A1C1F] hover:bg-[#721518] text-white">
                Cancel Booking
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {error && (
        <p className="px-5 pb-3 text-[11px] text-[#DC2626]">{error}</p>
      )}
    </div>
  );
}

/** Admin view of who booked what: client, service, date, time and status. */
function AdminAppointmentsList({
  appointments, onChanged,
}: {
  appointments: Appointment[];
  onChanged: () => void | Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const todayISO = toISODate(new Date());

  const upcoming = useMemo(
    () => appointments
      .filter((a) => a.status === "booked" && a.appointment_date >= todayISO)
      .sort((a, b) =>
        a.appointment_date.localeCompare(b.appointment_date) ||
        slotMinutes(a.time_slot) - slotMinutes(b.time_slot)),
    [appointments, todayISO],
  );

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
      await onChanged();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-black/6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={13} className="text-[#8A1C1F]" />
          <h3 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">Client Appointments</h3>
        </div>
        <span className="text-[10px] font-bold bg-[#8A1C1F]/10 text-[#8A1C1F] px-2 py-0.5 rounded-full">
          {upcoming.length} upcoming
        </span>
      </div>

      {upcoming.length === 0 ? (
        <p className="px-5 py-6 text-xs text-[#6b6b6b]">No upcoming appointments yet.</p>
      ) : (
        <div className="divide-y divide-black/5 max-h-[420px] overflow-y-auto">
          {upcoming.map((a) => (
            <div key={a.id} className="px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1E1E1E] truncate">
                    {a.client?.full_name || a.client?.email || "Client"}
                  </p>
                  <p className="text-[10px] text-[#6b6b6b] mt-0.5">
                    {a.case ? `${moduleLabel(a.case.module)} · ${a.case.reference}` : "Consultation"}
                  </p>
                  <p className="text-[11px] font-medium text-[#344248] mt-1">
                    {formatLongDate(parseISODate(a.appointment_date))} · {a.time_slot}
                  </p>
                </div>
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-[#16A34A] bg-[#16A34A]/10 px-2 py-0.5 rounded-full">
                  Booked
                </span>
              </div>
              <div className="flex gap-2 mt-2.5">
                <button type="button" disabled={busyId === a.id}
                  onClick={() => void act(a.id, () => scheduleService.complete(a.id))}
                  className="text-[10px] font-semibold text-[#16A34A] border border-[#16A34A]/30 px-2.5 py-1 rounded-md hover:bg-[#16A34A]/5 disabled:opacity-60">
                  Mark Done
                </button>
                <button type="button" disabled={busyId === a.id}
                  onClick={() => void act(a.id, () => scheduleService.cancel(a.id, "Cancelled by the office"))}
                  className="text-[10px] font-semibold text-[#DC2626] border border-[#DC2626]/30 px-2.5 py-1 rounded-md hover:bg-[#DC2626]/5 disabled:opacity-60">
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Schedule View ────────────────────────────────────────────────────────────

function ScheduleView({ isAdmin = false }: { isAdmin?: boolean }) {
  const { profile } = useAuth();
  const { overrides, bookedSlots, appointments, reload, fullSlots, halfSlots } = useSchedule();
  const { activeCase } = useClientPortal();

  // Slot labels come from the database; fall back to the built-in list while
  // the first load is still in flight.
  const openSlots = fullSlots.length ? fullSlots : FULL_SLOTS;
  const amSlots   = halfSlots.length ? halfSlots : HALF_SLOTS;

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
  const [overrideError, setOverrideError] = useState("");

  const year  = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const offset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthDates = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1));
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // Live bookings for every client, so a date can be reported as full.
  const takenByDate = bookedSlots;

  /** Slots of a date that cannot be taken: booked by anyone, or already past. */
  const unavailableFor = useCallback(
    (date: Date, status: DayStatus): string[] => {
      const slots = daySlots(status, openSlots, amSlots, overrides[toISODate(date)]);
      return [...(takenByDate[toISODate(date)] ?? []), ...pastSlotsFor(date, slots)];
    },
    [takenByDate, openSlots, amSlots, overrides],
  );

  /** Slots still free on a date, given the day's operating pattern. */
  const remainingFor = useCallback(
    (date: Date, status: DayStatus): number => {
      const slots = daySlots(status, openSlots, amSlots, overrides[toISODate(date)]);
      if (!slots.length) return 0;
      const gone = unavailableFor(date, status);
      return slots.filter((s) => !gone.includes(s)).length;
    },
    [unavailableFor, openSlots, amSlots, overrides],
  );

  const isBookable = useCallback(
    (date: Date, status: DayStatus) => isOperating(status) && remainingFor(date, status) > 0,
    [remainingFor],
  );

  // A client may hold only one upcoming booking (also enforced by the database).
  const todayISO = toISODate(new Date());
  const myUpcoming = useMemo(
    () =>
      isAdmin
        ? null
        : appointments.find(
            (a) => a.status === "booked" && a.client_id === profile?.id && a.appointment_date >= todayISO,
          ) ?? null,
    [appointments, isAdmin, profile?.id, todayISO],
  );

  const bookingsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of appointments) {
      if (a.status === "booked") map[a.appointment_date] = (map[a.appointment_date] ?? 0) + 1;
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
    if (overrideMode === "custom" && clockMinutes(customClose) - clockMinutes(customOpen) < 60) {
      setOverrideError("Closing time must be at least one hour after opening time.");
      return;
    }
    setOverrideError("");
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
    if (myUpcoming || !isBookable(date, status)) return;
    setUserPicked((prev) => (prev && toISODate(prev) === toISODate(date) ? null : date));
  };

  const bookSlot = async (date: Date, slot: string) => {
    if (!profile) return;
    const caseOpen = !!activeCase && !["done", "cancelled"].includes(String(activeCase.db_status ?? activeCase.status));
    await scheduleService.book({
      clientId: profile.id,
      date: toISODate(date),
      timeSlot: slot,
      caseId: caseOpen ? activeCase!.id : null,
    });
    await reload();
  };

  const pickedStatus = userPicked ? computeDayStatus(userPicked, overrides) : null;
  const pickedTaken = userPicked && pickedStatus ? unavailableFor(userPicked, pickedStatus) : [];

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily:"'Poppins',sans-serif" }}>
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
              { cls:"bg-[#f0f0f0] border-[#6b6b6b]/30", label:"Fully Booked" },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5 text-[10px] text-[#6b6b6b] font-semibold">
                <div className={`w-3.5 h-3.5 rounded border ${l.cls} shrink-0`} />
                {l.label}
              </div>
            ))}
          </div>
        </div>

        {myUpcoming && (
          <div className="mb-6">
            <MyAppointmentCard appointment={myUpcoming} onChanged={reload} />
            <p className="text-[11px] text-[#D97706] font-medium mt-2">
              You already have an upcoming appointment. Cancel it first if you need to book a different time.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
          {/* Calendar */}
          <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden flex flex-col h-full">
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
            <div className="grid grid-cols-7 flex-1 auto-rows-fr">
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
                const operating = isOperating(status);
                const pastDay = iso < todayISO;
                const remaining = operating ? remainingFor(date, status) : 0;
                const full = operating && !pastDay && remaining === 0;
                const bookedCount = bookingsByDate[iso] ?? 0;

                return (
                  <button key={iso}
                    onClick={() => isAdmin ? toggleAdminSel(iso) : handleUserClick(date, status)}
                    disabled={!isAdmin && (status === "sunday" || status === "closed" || full || pastDay || !!myUpcoming)}
                    aria-label={
                      full && !isAdmin
                        ? `${formatLongDate(date)} — fully booked`
                        : formatLongDate(date)
                    }
                    className={`border-b border-r border-black/5 min-h-[72px] p-2 text-left flex flex-col transition-all relative ${
                      pastDay && !isAdmin
                        ? "bg-[#fafafa] cursor-not-allowed opacity-50"
                        : full && !isAdmin ? "bg-[#f0f0f0] cursor-not-allowed" : style.cell
                    } ${
                      selAdmin ? "ring-2 ring-inset ring-[#344248] bg-[#344248]/10" : ""
                    } ${picked ? "ring-2 ring-inset ring-[#8A1C1F]" : ""}`}>
                    <span className={`text-sm ${full && !isAdmin ? "text-[#A0A0A0]" : style.text}`}>{d}</span>

                    {/* Status badge */}
                    {style.badge && (
                      <span className={`mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full leading-none ${style.badge}`}>
                        {ov?.type === "custom" && ov.open_time && ov.close_time
                          ? `${clockLabel(ov.open_time)}–${clockLabel(ov.close_time)}`
                          : style.badgeText}
                      </span>
                    )}

                    {/* Availability. Only show slots left when 4 or fewer remain, in red.
                        Remove AM prefix so Saturdays read cleanly. */}
                    {isAdmin && bookedCount > 0 && (
                      <span className="mt-auto text-[8px] font-bold text-[#8A1C1F]">
                        {bookedCount} booking{bookedCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {!isAdmin && operating && !pastDay && !picked && (
                      full ? (
                        <span className="mt-auto text-[8px] text-[#6b6b6b] font-bold uppercase tracking-wide">
                          Fully booked
                        </span>
                      ) : remaining <= 4 ? (
                        <span className="mt-auto text-[8px] font-bold text-[#DC2626]">
                          {remaining} slot{remaining === 1 ? "" : "s"} left
                        </span>
                      ) : null
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
                { dot:"bg-[#2563EB]",  text:"Custom hours — set by the office for that date" },
                { dot:"bg-[#DC2626]",  text:"Admin override — Full closure" },
                { dot:"bg-[#6b6b6b]",  text:"Fully booked — no slots left for that date" },
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

                    {overrideError && (
                      <p className="text-[11px] text-[#DC2626] font-medium">{overrideError}</p>
                    )}
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
                                 `Custom: ${clockLabel(ov.open_time ?? "00:00")}–${clockLabel(ov.close_time ?? "00:00")}`}
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

                <AdminAppointmentsList appointments={appointments} onChanged={reload} />

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
                {/* Office Hours (always shown) */}
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

                {/* User Slot Panel Modal */}
                <Dialog open={!!userPicked && !!pickedStatus} onOpenChange={(open) => !open && setUserPicked(null)}>
                  <DialogContent className="sm:max-w-md p-0 border-0 bg-transparent shadow-none [&>button]:hidden">
                    {userPicked && pickedStatus && (
                      <TimeSlotPanel date={userPicked} status={pickedStatus}
                        takenSlots={pickedTaken}
                        fullSlots={openSlots} halfSlots={amSlots}
                        override={overrides[toISODate(userPicked)]}
                        onBook={(slot) => bookSlot(userPicked, slot)}
                        onClose={() => setUserPicked(null)} />
                    )}
                  </DialogContent>
                </Dialog>

                {/* Next available dates */}
                <div className="bg-white rounded-xl border border-black/8 shadow-sm p-5">
                  <h3 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm mb-3">Next Available</h3>
                  {(() => {
                    // Only days that are open *and* still have a free slot.
                    const available = monthDates.filter((date) =>
                      isBookable(date, computeDayStatus(date, overrides)),
                    );

                    if (!available.length) {
                      return (
                        <p className="text-xs text-[#6b6b6b] py-2">
                          No slots left this month. Try the next month, or contact the office for a walk-in.
                        </p>
                      );
                    }

                    return available.slice(0, 6).map((date) => {
                      const s = computeDayStatus(date, overrides);
                      const iso = toISODate(date);
                      const left = remainingFor(date, s);
                      return (
                        <button key={iso} onClick={() => setUserPicked(date)}
                          className="w-full flex items-center justify-between py-2.5 border-b border-black/5 last:border-0 hover:bg-[#f5f0ef] px-1 rounded transition-colors">
                          <span className="text-xs font-medium text-[#1E1E1E]">
                            {formatLongDate(date)}
                          </span>
                          <span className={`text-[10px] font-semibold ${
                            s === "open" ? "text-[#16A34A]" : "text-[#D97706]"
                          }`}>
                            {left} {s === "halfday" ? "AM " : ""}slot{left === 1 ? "" : "s"} left
                          </span>
                        </button>
                      );
                    });
                  })()}
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

/**
 * Account settings: change the password while signed in. The current password
 * is re-checked first so a borrowed, unlocked session cannot silently take over
 * the account.
 */
function ChangePasswordCard() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent(""); setNext(""); setConfirm(""); setShow(false); setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setDone(false);
    if (!current) { setError("Enter your current password."); return; }
    const weak = validatePassword(next);
    if (weak) { setError(weak); return; }
    if (next === current) { setError("Your new password must be different from the current one."); return; }
    if (next !== confirm) { setError("The two new passwords do not match."); return; }
    if (!profile?.email) { setError("Your account has no email on file."); return; }

    setSaving(true);
    try {
      await authService.changePassword(profile.email, current, next);
      reset();
      setOpen(false);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full border border-black/15 rounded-lg px-3 py-2.5 text-sm bg-[#f5f5f5] outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20";

  return (
    <div className="bg-white rounded-2xl border border-black/8 shadow-sm overflow-hidden mb-4">
      <div className="px-5 py-3.5 border-b border-black/6 flex items-center justify-between">
        <p className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-widest">Security</p>
        {!open && (
          <button type="button" onClick={() => { setOpen(true); setDone(false); }}
            className="text-xs font-semibold text-[#8A1C1F] hover:underline">
            Change Password
          </button>
        )}
      </div>

      {done && !open && (
        <div className="px-5 py-4 flex items-center gap-2 text-[#16A34A] text-xs">
          <CheckCircle size={13} /> Your password has been changed.
        </div>
      )}
      {!open && !done && (
        <p className="px-5 py-4 text-xs text-[#6b6b6b]">
          Update the password you use to sign in to your portal.
        </p>
      )}

      {open && (
        <form onSubmit={submit} noValidate className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#6b6b6b] uppercase tracking-wide mb-1.5">Current Password</label>
            <input type={show ? "text" : "password"} value={current} onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6b6b6b] uppercase tracking-wide mb-1.5">New Password</label>
            <input type={show ? "text" : "password"} value={next} onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password" className={inputClass} />
            <PasswordStrength password={next} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6b6b6b] uppercase tracking-wide mb-1.5">Confirm New Password</label>
            <input type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password" className={inputClass} />
            {confirm && next !== confirm && (
              <p className="text-[11px] text-[#DC2626] mt-1.5 font-medium">Passwords do not match.</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-[#6b6b6b] cursor-pointer">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Show passwords
          </label>

          {error && (
            <div className="flex items-start gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-lg px-3 py-2.5 leading-relaxed">
              <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => { reset(); setOpen(false); }}
              className="flex-1 border border-black/15 text-[#344248] text-sm font-semibold py-2.5 rounded-lg hover:bg-[#f0f0f0] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-[#8A1C1F] text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-[#6d1518] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {saving && <Loader2 size={14} className="animate-spin" />} Update Password
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

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

  const [profileError, setProfileError] = useState("");

  const save = async () => {
    if (!profile) return;
    const problem = validateFullName(fullName) ?? validatePhone(phone);
    if (problem) {
      setProfileError(problem);
      return;
    }
    setProfileError("");
    setSaving(true);
    try {
      await profileService.update(profile.id, {
        full_name: fullName.trim(),
        phone: phone.trim() ? normalizePhone(phone) : null,
      });
      await refreshProfile();
      setEditing(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not save your profile.");
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
    <div className="bg-[#F4F5F7] pb-24 sm:pb-0" style={{ fontFamily:"'Poppins',sans-serif", minHeight:"calc(100vh - 56px)" }}>
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
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+639XXXXXXXXX"
                  className="w-full border border-black/15 rounded-lg px-3 py-2.5 text-sm bg-[#f5f5f5] outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20" />
              </div>
              {profileError && (
                <div className="flex items-start gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-lg px-3 py-2.5 leading-relaxed">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" /> {profileError}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setEditing(false); setProfileError(""); }}
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

        <ChangePasswordCard />

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {!editing && (
            <button onClick={startEdit}
              className="w-full flex items-center justify-center gap-2 bg-[#344248] text-white py-3.5 rounded-xl font-semibold text-sm hover:bg-[#2a3540] active:opacity-80 transition-all">
              <User size={15} /> Edit Profile
            </button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                className="w-full flex items-center justify-center gap-2 border-2 border-[#DC2626]/25 text-[#DC2626] py-3.5 rounded-xl font-semibold text-sm hover:bg-[#DC2626]/5 active:opacity-80 transition-all">
                <LogOut size={15} /> Sign Out
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign Out</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to sign out of your account? You will need to log in again to access your dashboard.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onLogout} className="bg-[#8A1C1F] hover:bg-[#721518] text-white">
                  Sign Out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily:"'Poppins',sans-serif" }}>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
          {metricCards.map((m) => (
            <div key={m.label} className={`rounded-xl border p-4 sm:p-5 shadow-sm ${m.cls}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1 ${m.text} opacity-70`}>{m.label}</p>
              <p className={`text-3xl sm:text-4xl font-black ${m.text}`}>{m.val}</p>
            </div>
          ))}
        </div>

        {/* Worklist */}
        <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-black/6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck size={14} className="text-[#344248] shrink-0" />
              <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm truncate">Operational Worklist</h2>
            </div>
            <span className="text-xs text-[#6b6b6b] shrink-0">{cases.length} active records</span>
          </div>
          {loading ? (
            <Spinner label="Loading cases…" />
          ) : cases.length === 0 ? (
            <EmptyState message="No cases have been submitted yet." />
          ) : (
          <>
          {/* Mobile card list — the table used to overflow the viewport on a
              phone, hiding the status and action columns entirely. */}
          <div className="sm:hidden divide-y divide-black/5">
            {cases.map((c) => (
              <button key={c.id} type="button" onClick={() => onReview(c)}
                className="w-full text-left px-4 py-3.5 hover:bg-[#FDFDFD] transition-colors">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <p className="font-mono text-[10px] text-[#344248]">{c.reference}</p>
                  <StatusBadge status={c.status} />
                </div>
                <p className="font-medium text-[#1E1E1E] text-sm truncate">
                  {c.client?.full_name ?? c.client?.email ?? "—"}
                </p>
                <div className="flex items-center justify-between gap-3 mt-1">
                  <p className="text-xs text-[#6b6b6b] truncate">{moduleLabel(c.module)}</p>
                  <span className="text-[10px] text-[#A0A0A0] shrink-0">{timeAgo(c.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Table from sm up, still scrollable if the viewport is narrow */}
          <div className="hidden sm:block overflow-x-auto scrollbar-none">
          <table className="w-full text-sm min-w-[720px]">
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
          </div>
          </>
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

  /**
   * Which case the progress stepper describes.
   *
   * This used to be hard-coded to `cases[0]`, the most recently updated case.
   * That is why the panel looked like it "only updates when you open Review Case
   * Files and change the phase" — editing a phase made that case the most
   * recently updated one, so it became `cases[0]`. Clicking a card now selects
   * it explicitly.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  const selected =
    cases.find((c) => c.id === selectedId) ?? cases[0] ?? null;
  const activeStep = selected ? Math.max(0, phases.indexOf(selected.phase)) : 0;
  // A case in the "waiting" state is stalled at its current phase.
  const stalledAt = selected?.status === "waiting" ? activeStep : steps.length;

  const selectCase = (c: CaseWithClient) => {
    setSelectedId(c.id);
    // The stepper sits below the card grid, so bring it into view on smaller
    // screens where the selection would otherwise happen off-screen.
    progressRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily:"'Poppins',sans-serif" }}>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-2xl font-bold text-[#1E1E1E] mb-1">Case Worklist</h1>
        <p className="text-sm text-[#6b6b6b] mb-7">
          Live case tracking and progress management. Select a case to see its progress.
        </p>

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
          {cases.map((c) => {
            const isSelected = selected?.id === c.id;
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => selectCase(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectCase(c);
                  }
                }}
                className={`bg-white rounded-xl shadow-sm p-5 cursor-pointer transition-all text-left border ${
                  isSelected
                    ? "border-[#8A1C1F] ring-2 ring-[#8A1C1F]/15"
                    : "border-black/8 hover:border-[#8A1C1F]/40"
                }`}>
                <div className="flex items-start justify-between mb-3 gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-mono text-[#6b6b6b]">{c.reference}</p>
                    <p className="font-semibold text-[#1E1E1E] text-sm truncate">{c.client?.full_name ?? c.client?.email ?? "—"}</p>
                    <p className="text-xs text-[#344248]">{moduleLabel(c.module)}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>

                {/* Current stage, so the card itself answers "where is this case?" */}
                <p className="text-[11px] text-[#6b6b6b] mb-1">
                  Stage <span className="font-semibold text-[#1E1E1E]">{c.phase}</span>
                  <span className="text-[#A0A0A0]">
                    {" "}· {Math.max(0, phases.indexOf(c.phase)) + 1} of {phases.length}
                  </span>
                </p>
                <p className="text-[10px] text-[#A0A0A0] mb-3">Updated {timeAgo(c.updated_at)}</p>

                <button type="button"
                  onClick={(e) => { e.stopPropagation(); onReview(c); }}
                  className="text-xs text-[#8A1C1F] font-semibold hover:underline flex items-center gap-1">
                  Review Case Files <ChevronRight size={11} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Progress stepper for the selected case */}
        {selected && (
        <div ref={progressRef} className="bg-white rounded-xl border border-black/8 shadow-sm p-5 sm:p-6 scroll-mt-20">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 style={{ fontFamily:"'Cinzel',serif" }} className="font-bold text-[#1E1E1E]">
              Case Progress — {selected.reference}
            </h2>
            <StatusBadge status={selected.status} />
          </div>
          <p className="text-xs text-[#6b6b6b] mb-4">
            {selected.client?.full_name ?? selected.client?.email ?? "—"} · {moduleLabel(selected.module)}
          </p>
          {selected.status === "waiting" && (
            <p className="text-xs text-[#DC2626] mb-5 flex items-center gap-1.5">
              <AlertCircle size={12} /> Missing documents — dashed connector marks stalled stage.
            </p>
          )}
          <div className="flex items-center overflow-x-auto scrollbar-none pb-2 gap-0">
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

          <button type="button" onClick={() => onReview(selected)}
            className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#8A1C1F] hover:bg-[#6d1518] rounded-xl px-4 py-2.5 transition-colors">
            Open in Verify <ChevronRight size={12} />
          </button>
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
  const [busy, setBusy] = useState<null | "phase" | "dispatch" | "approve" | "reject">(null);
  const [info, setInfo] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    setPhase(selectedCase?.phase ?? "Under Review");
    setNote("");
    setInfo("");
    setProblem("");
  }, [selectedCase]);

  if (!selectedCase) {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7] flex items-center justify-center" style={{ fontFamily:"'Poppins',sans-serif" }}>
        <EmptyState message="Select a case from the Dashboard or Worklist to review it here." />
      </div>
    );
  }

  const clientName = selectedCase.client?.full_name || selectedCase.client?.email || "Client";
  const recipient = selectedCase.client?.email ?? "";

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
        recipientId: selectedCase.client_id || selectedCase.client?.id,
        channel: "email",
        message: note.trim(),
        createdBy: profile.id,
      });
      setNote("");
      setInfo("Notification dispatched and queued for client.");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: StatusKey, action: "approve" | "reject") => {
    setBusy(action);
    setProblem("");
    try {
      await casesService.updateStatus(selectedCase.id, status);
      onDone();
      setInfo(action === "approve" ? "Case marked as approved." : "Case flagged — client action required.");
    } catch (err) {
      // e.g. the database refuses approval while required documents are missing.
      setInfo("");
      setProblem(err instanceof Error ? err.message : "Could not update the case.");
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
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7] flex flex-col lg:flex-row gap-0" style={{ fontFamily:"'Poppins',sans-serif" }}>
      {/* Left control — full width on mobile, 35% from lg up */}
      <div className="w-full lg:w-[35%] bg-white border-b lg:border-b-0 lg:border-r border-black/8 flex flex-col gap-5 p-5 sm:p-7 lg:overflow-auto">
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
          <div className="flex items-center gap-2 text-xs text-[#344248] bg-[#F4F5F7] rounded-lg px-3 py-2.5">
            <Mail size={13} className="shrink-0" />
            <span className="truncate">Portal + Email{recipient ? ` (${recipient})` : ""}</span>
          </div>
          {!recipient && (
            <p className="text-[10px] text-[#D97706] mt-1.5">Client has no email on file.</p>
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
        {problem && (
          <div className="flex items-start gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-lg px-3 py-2.5 leading-relaxed">
            <AlertCircle size={12} className="shrink-0 mt-0.5" /> {problem}
          </div>
        )}

        <div className="mt-auto border-t border-black/8 pt-4">
          <p className="text-[10px] text-[#6b6b6b] flex items-center gap-1.5"><Clock size={11} /> Last updated {timeAgo(selectedCase.updated_at)}</p>
        </div>
      </div>

      {/* Right document view — 65% */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="bg-white border-b border-black/8 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="flex-1 min-w-0 text-sm font-medium text-[#344248] truncate">
            {selectedCase.reference} · {moduleLabel(selectedCase.module)}
          </span>
          <button onClick={() => setStatus("done", "approve")} disabled={busy === "approve"}
            className="flex items-center gap-1.5 bg-[#16A34A] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#15803d] transition-colors disabled:opacity-60">
            {busy === "approve" ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve Case
          </button>
          <button onClick={() => setStatus("waiting", "reject")} disabled={busy === "reject"}
            className="flex items-center gap-1.5 bg-[#8A1C1F] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#6d1518] transition-colors disabled:opacity-60">
            {busy === "reject" ? <Loader2 size={12} className="animate-spin" /> : <Flag size={12} />} Flag Case
          </button>
        </div>

        {/* The client's actual uploads, with a verdict per document. */}
        <CaseDocuments
          key={selectedCase.id}
          caseId={selectedCase.id}
          clientName={clientName}
          onChanged={onDone}
        />
      </div>
    </div>
  );
}

// ─── Admin: Notifications ────────────────────────────────────────────────────

function AdminNotifications() {
  const { notifications, loading, error, reload } = useNotifications();
  const [retrying, setRetrying] = useState(false);

  // Counted from the real delivery state rather than the legacy status flag.
  const tally = useMemo(() => {
    const counts: Record<DeliveryStatus, number> = {
      queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0,
    };
    for (const n of notifications) {
      if (counts[n.delivery_status] !== undefined) counts[n.delivery_status] += 1;
    }
    return counts;
  }, [notifications]);

  const outstanding = tally.queued + tally.failed;

  /** Nudges the delivery function to drain anything still waiting. */
  const retryQueue = async () => {
    setRetrying(true);
    try {
      await notificationsService.dispatch();
      await reload();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily:"'Poppins',sans-serif" }}>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-2xl font-bold text-[#1E1E1E] mb-1">Notification History</h1>
        <p className="text-sm text-[#6b6b6b] mb-5">Outbound messaging traffic and delivery audit log.</p>

        {/* Delivery breakdown */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {(["sent", "queued", "failed", "skipped"] as DeliveryStatus[]).map((k) => (
            <span key={k}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold bg-white border border-black/8 rounded-full px-3 py-1.5 ${deliveryConfig[k].tone}`}>
              {deliveryConfig[k].icon}
              {tally[k]} {deliveryConfig[k].label}
            </span>
          ))}
          {outstanding > 0 && (
            <button type="button" onClick={retryQueue} disabled={retrying}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#8A1C1F] hover:bg-[#6d1518] rounded-full px-3.5 py-1.5 transition-colors disabled:opacity-60">
              {retrying ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
              Retry {outstanding} pending
            </button>
          )}
        </div>

        {tally.skipped > 0 && (
          <div className="mb-6 flex items-start gap-2.5 text-[#D97706] text-xs bg-[#D97706]/8 border border-[#D97706]/20 rounded-xl px-3.5 py-3 leading-relaxed">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <p>
              <span className="font-semibold">{tally.skipped} message(s) were not sent</span> because a
              delivery provider is not configured. In-portal notifications still work; email needs
              <code className="mx-1 px-1 bg-black/5 rounded">RESEND_API_KEY</code> and
              <code className="mx-1 px-1 bg-black/5 rounded">NOTIFY_EMAIL_FROM</code>
              to be set on the <code className="mx-1 px-1 bg-black/5 rounded">send-notification</code> function.
            </p>
          </div>
        )}

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
            <span className="text-xs text-[#6b6b6b]">{notifications.length} log entries</span>
          </div>
          {loading ? (
            <Spinner label="Loading notifications…" />
          ) : notifications.length === 0 ? (
            <EmptyState message="No notifications have been dispatched yet." />
          ) : (
          <div className="divide-y divide-black/5">
            {notifications.map((n) => (
              <div key={n.id} className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 hover:bg-[#FDFDFD] transition-colors">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-[#344248]/10">
                    <Mail size={14} className="text-[#344248]" />
                  </div>
                  <div className="w-full sm:w-40 min-w-0">
                    <p className="text-[10px] font-semibold text-[#344248] uppercase tracking-wide mb-0.5">
                      Email
                    </p>
                    <p className="text-[10px] text-[#6b6b6b] break-all truncate sm:whitespace-normal">{n.recipient}</p>
                  </div>
                  <span className={`sm:hidden ml-auto inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${
                    deliveryConfig[n.delivery_status]?.tone ?? "text-[#6b6b6b]"
                  }`}>
                    {deliveryConfig[n.delivery_status]?.icon}
                    {deliveryConfig[n.delivery_status]?.label ?? n.delivery_status}
                  </span>
                </div>
                <div className="flex-1 min-w-0 w-full">
                  <p className="text-sm text-[#1E1E1E] leading-relaxed break-words">{n.message}</p>
                  <p className="text-[10px] text-[#A0A0A0] mt-1">
                    {formatDateTime(n.created_at)}
                    {n.sent_at && ` · delivered ${formatDateTime(n.sent_at)}`}
                    {n.attempts > 1 && ` · ${n.attempts} attempts`}
                  </p>
                  {/* Surfacing the provider error turns a silent "pending" into
                      something the office can act on. */}
                  {n.error && (n.delivery_status === "failed" || n.delivery_status === "skipped") && (
                    <p className="text-[10px] text-[#DC2626] mt-1 leading-relaxed break-words">{n.error}</p>
                  )}
                </div>
                <span className={`hidden sm:inline-flex shrink-0 ml-4 items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${
                  deliveryConfig[n.delivery_status]?.tone ?? "text-[#6b6b6b]"
                }`}>
                  {deliveryConfig[n.delivery_status]?.icon}
                  {deliveryConfig[n.delivery_status]?.label ?? n.delivery_status}
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
    <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7]" style={{ fontFamily:"'Poppins',sans-serif" }}>
      <div className="relative flex items-center justify-center w-24 h-24">
        {/* Brand mark, with a spinner ring orbiting it */}
        <CrestMark size={56} />
        <div className="absolute inset-0 rounded-full border-[3px] border-[#8A1C1F]/15 border-t-[#8A1C1F] animate-spin" />
      </div>
    </div>
  );
}

// ─── Password recovery (arrival from a reset email) ──────────────────────────

function PasswordRecoveryScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const weak = validatePassword(password);
    if (weak) { setError(weak); return; }
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    setSaving(true);
    try {
      await authService.updatePassword(password);
      // The reset link created a temporary session. Keeping the user signed in
      // would skip the one check that matters — that the new password actually
      // stuck. Sign out so they immediately sign in with it, proving the change
      // persisted (the client reported a reset that "worked" only until the
      // browser was reopened).
      try {
        await authService.signOut();
      } catch {
        /* signing out is best-effort after a successful password update */
      }
      sessionStorage.setItem(PW_UPDATED_FLAG, "1");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7] px-6" style={{ fontFamily:"'Poppins',sans-serif" }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-black/8 shadow-sm p-8">
        <div className="flex flex-col items-center mb-6">
          <CrestMark size={56} />
          <h1 style={{ fontFamily:"'Cinzel',serif" }} className="text-xl font-bold text-[#1E1E1E] mt-4">
            Set a New Password
          </h1>
          <p className="text-xs text-[#6b6b6b] mt-1 text-center">
            Choose a new password to finish signing in to your portal.
          </p>
        </div>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">New Password</label>
            <div className="relative">
              <input value={password} onChange={(e) => setPassword(e.target.value)}
                type={showPass ? "text" : "password"} placeholder="Enter new password"
                autoComplete="new-password"
                className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all pr-12" />
              <button type="button" onClick={() => setShowPass(!showPass)}
                aria-label={showPass ? "Hide password" : "Show password"}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#6b6b6b] hover:text-[#1E1E1E]">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <PasswordStrength password={password} />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#1E1E1E] mb-1.5">Confirm Password</label>
            <div className="relative">
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)}
                type={showConfirm ? "text" : "password"} placeholder="Confirm new password"
                autoComplete="new-password"
                className="w-full border border-black/15 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20 bg-[#f5f5f5] transition-all pr-12" />
              <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                aria-label={showConfirm ? "Hide password" : "Show password"}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#6b6b6b] hover:text-[#1E1E1E]">
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {confirm && password !== confirm && (
              <p className="text-[11px] text-[#DC2626] mt-1.5 font-medium">
                Passwords do not match.
              </p>
            )}
            {confirm && password === confirm && (
              <p className="text-[11px] text-[#16A34A] mt-1.5 font-medium flex items-center gap-1">
                <CheckCircle size={12} /> Passwords match
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3">
              <AlertCircle size={13} className="shrink-0" /> {error}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full bg-[#8A1C1F] text-white py-3.5 rounded-xl font-semibold text-sm hover:bg-[#6d1518] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
            {saving && <Loader2 size={15} className="animate-spin" />}
            Save Password
          </button>
        </form>
      </div>
    </div>
  );
}

// The reset link lands back here with `type=recovery` in the URL fragment; the
// hash is captured at module load because Supabase clears it once consumed.
const ARRIVED_FROM_RESET_LINK =
  typeof window !== "undefined" && window.location.hash.includes("type=recovery");

export default function App() {
  const { session, role, loading, signOut } = useAuth();
  const [recovering, setRecovering] = useState(ARRIVED_FROM_RESET_LINK);

  useEffect(() => authService.onPasswordRecovery(() => setRecovering(true)), []);
  const [userTab, setUserTab] = useState<UserTab>(() => {
    return (localStorage.getItem("userTab") as UserTab) || "dashboard";
  });
  const [adminTab, setAdminTab] = useState<AdminTab>(() => {
    return (localStorage.getItem("adminTab") as AdminTab) || "dashboard";
  });

  useEffect(() => {
    localStorage.setItem("userTab", userTab);
  }, [userTab]);

  useEffect(() => {
    localStorage.setItem("adminTab", adminTab);
  }, [adminTab]);
  const [reviewCase, setReviewCase] = useState<CaseWithClient | null>(null);

  // Announce this tab as online so the admin client register shows real
  // Online/Offline state instead of an always-"Active" badge.
  const presenceUserId = session?.user?.id ?? null;
  useEffect(() => {
    if (!presenceUserId) return;
    joinPresence(presenceUserId);
    return () => leavePresence();
  }, [presenceUserId]);

  // One feed for the whole portal; TopNav renders the badge and the panel from it.
  const notifApi = useNotifications();

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

  // A recovery session must set a new password before reaching the portal.
  if (recovering && session) {
    return <PasswordRecoveryScreen onDone={() => setRecovering(false)} />;
  }

  if (!session) return <LoginScreen />;

  // Signed in but the profile row (and therefore role) is still resolving.
  if (!role) return <LoadingScreen />;

  if (role === "user") {
    return (
      <div className="min-h-screen bg-[#F4F5F7] sm:pb-0" style={{ paddingBottom: 0 }}>
        <TopNav role="user" tab={userTab} setTab={setUserTab} onLogout={handleLogout} notifications={notifApi} />
        {userTab === "dashboard" && <ClientDashboard />}
        {userTab === "history"   && <ClientHistory />}
        {userTab === "schedule"  && <ScheduleView isAdmin={false} />}
        {userTab === "profile"   && <ClientProfile onLogout={handleLogout} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <TopNav role="admin" tab={adminTab} setTab={setAdminTab} onLogout={handleLogout} notifications={notifApi} />
      {adminTab === "dashboard"     && <AdminDashboard onReview={openReview} />}
      {adminTab === "worklist"      && <AdminWorklist  onReview={openReview} />}
      {adminTab === "verify"        && <AdminVerify selectedCase={reviewCase} onDone={() => { /* live data refreshes on next open */ }} />}
      {adminTab === "clients"       && <AdminClients />}
      {adminTab === "schedule"      && <ScheduleView isAdmin />}
      {adminTab === "reports"       && <AdminReports />}
      {adminTab === "notifications" && <AdminNotifications />}
    </div>
  );
}
