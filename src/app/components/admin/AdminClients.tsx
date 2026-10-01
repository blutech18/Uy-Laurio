import { useEffect, useState } from "react";
import {
  CheckCircle, Loader2, Mail, Search, Smartphone, UserPlus, UserX, X,
} from "lucide-react";

import { EmptyState, ErrorBanner, Spinner } from "@/app/components/shared/States";
import { useAdminClients } from "@/hooks/useAdminClients";
import { formatDate, timeAgo } from "@/lib/format";
import { subscribePresence } from "@/lib/presence";
import { validateEmail, validateFullName, validatePassword, validatePhone, normalizePhone } from "@/lib/validation";
import type { ClientSummary } from "@/types/models";

type Filter = "all" | "active" | "inactive";

/**
 * Staff-side client account management: search the register, add a walk-in
 * client, correct contact details, and deactivate an account without deleting
 * the record. Every write is gated by `is_admin()` in the database.
 */
export function AdminClients() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ClientSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => subscribePresence(setOnlineIds), []);

  const { clients, total, loading, error, reload, createClient, updateClient, setActive } =
    useAdminClients({
      search: search.trim() || undefined,
      active: filter === "all" ? undefined : filter === "active",
    });

  const toggleActive = async (client: ClientSummary) => {
    setBusyId(client.id);
    setActionError("");
    try {
      await setActive(client.id, !client.is_active);
      setNotice(
        client.is_active
          ? `${client.full_name || client.email} can no longer sign in.`
          : `${client.full_name || client.email} has been reactivated.`,
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not update the account.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily: "'Poppins',sans-serif" }}>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 style={{ fontFamily: "'Cinzel',serif" }} className="text-2xl font-bold text-[#1E1E1E] mb-1">
              Client Accounts
            </h1>
            <p className="text-sm text-[#6b6b6b]">
              {total} record{total === 1 ? "" : "s"} on file. Add walk-in clients and maintain their details.
            </p>
          </div>
          <button onClick={() => { setAddOpen(true); setNotice(""); setActionError(""); }}
            className="flex items-center gap-2 bg-[#8A1C1F] text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-[#6d1518] transition-colors">
            <UserPlus size={14} /> Add Client
          </button>
        </div>

        {error && <ErrorBanner message={error} />}
        {actionError && <ErrorBanner message={actionError} />}
        {notice && (
          <div className="mb-6 flex items-center gap-2 text-[#16A34A] text-xs bg-[#16A34A]/8 border border-[#16A34A]/20 rounded-xl px-3.5 py-3">
            <CheckCircle size={13} className="shrink-0" /> {notice}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0A0A0]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or phone…"
              aria-label="Search client accounts"
              className="w-full border border-black/10 rounded-lg bg-white pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20" />
          </div>
          {(["all", "active", "inactive"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold border-2 transition-colors capitalize ${
                filter === f
                  ? "border-[#8A1C1F] bg-[#8A1C1F]/5 text-[#8A1C1F]"
                  : "border-black/10 bg-white text-[#6b6b6b] hover:border-black/20"
              }`}>
              {f}
            </button>
          ))}
        </div>

        {/* Register */}
        <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
          {loading ? (
            <Spinner label="Loading client accounts…" />
          ) : clients.length === 0 ? (
            <EmptyState message="No client accounts match this filter." />
          ) : (
            <>
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-black/5">
                {clients.map((c) => (
                  <div key={c.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1E1E1E] truncate">{c.full_name || "—"}</p>
                        <p className="text-[11px] text-[#6b6b6b] truncate">{c.email}</p>
                      </div>
                      <StatusPill active={c.is_active} online={onlineIds.has(c.id)} />
                    </div>
                    <p className="text-[11px] text-[#6b6b6b] mt-2">
                      {c.case_count} case{c.case_count === 1 ? "" : "s"} · {c.open_cases} open
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setEditing(c)}
                        className="flex-1 border border-black/15 text-[#344248] text-xs font-semibold py-2 rounded-lg hover:bg-[#f0f0f0]">
                        Edit
                      </button>
                      <button onClick={() => toggleActive(c)} disabled={busyId === c.id}
                        className="flex-1 border border-black/15 text-[#8A1C1F] text-xs font-semibold py-2 rounded-lg hover:bg-[#f5f0ef] disabled:opacity-60">
                        {c.is_active ? "Deactivate" : "Reactivate"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#FDFDFD] border-b border-black/6">
                    <tr className="text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide">
                      <th scope="col" className="px-6 py-3">Client</th>
                      <th scope="col" className="px-6 py-3">Contact</th>
                      <th scope="col" className="px-6 py-3">Cases</th>
                      <th scope="col" className="px-6 py-3">Last activity</th>
                      <th scope="col" className="px-6 py-3">Registered</th>
                      <th scope="col" className="px-6 py-3">Status</th>
                      <th scope="col" className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {clients.map((c) => (
                      <tr key={c.id} className="hover:bg-[#FDFDFD] transition-colors">
                        <td className="px-6 py-3.5">
                          <p className="text-xs font-semibold text-[#1E1E1E]">{c.full_name || "—"}</p>
                          {c.role === "admin" && (
                            <span className="text-[9px] font-bold text-[#8A1C1F] uppercase tracking-widest">Staff</span>
                          )}
                          {c.notes && <p className="text-[10px] text-[#A0A0A0] mt-0.5 max-w-xs truncate">{c.notes}</p>}
                        </td>
                        <td className="px-6 py-3.5">
                          <p className="text-[11px] text-[#344248] flex items-center gap-1.5">
                            <Mail size={10} /> {c.email}
                          </p>
                          <p className="text-[11px] text-[#6b6b6b] flex items-center gap-1.5 mt-0.5">
                            <Smartphone size={10} /> {c.phone ?? "No phone on file"}
                          </p>
                        </td>
                        <td className="px-6 py-3.5 text-xs text-[#6b6b6b]">
                          {c.case_count} total
                          {c.open_cases > 0 && (
                            <span className="ml-1.5 text-[10px] font-semibold text-[#D97706]">
                              {c.open_cases} open
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-xs text-[#6b6b6b]">
                          {c.last_activity ? timeAgo(c.last_activity) : "—"}
                        </td>
                        <td className="px-6 py-3.5 text-xs text-[#6b6b6b]">{formatDate(c.created_at)}</td>
                        <td className="px-6 py-3.5"><StatusPill active={c.is_active} online={onlineIds.has(c.id)} /></td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditing(c)}
                              className="text-[11px] font-semibold text-[#344248] hover:underline">
                              Edit
                            </button>
                            <button onClick={() => toggleActive(c)} disabled={busyId === c.id}
                              className="text-[11px] font-semibold text-[#8A1C1F] hover:underline disabled:opacity-60 flex items-center gap-1">
                              {busyId === c.id
                                ? <Loader2 size={10} className="animate-spin" />
                                : <UserX size={10} />}
                              {c.is_active ? "Deactivate" : "Reactivate"}
                            </button>
                          </div>
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

      {addOpen && (
        <AddClientDialog
          onClose={() => setAddOpen(false)}
          onCreate={createClient}
          onCreated={(message) => { setNotice(message); setAddOpen(false); void reload(); }}
        />
      )}

      {editing && (
        <EditClientDialog
          client={editing}
          onClose={() => setEditing(null)}
          onSave={updateClient}
          onSaved={() => { setNotice("Client details updated."); setEditing(null); }}
        />
      )}
    </div>
  );
}

/**
 * Account state plus live presence: a deactivated account is flagged as such,
 * otherwise the client reads Online only while they actually have the portal
 * open (Realtime Presence), and Offline the rest of the time.
 */
function StatusPill({ active, online }: { active: boolean; online: boolean }) {
  if (!active) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#DC2626]/10 text-[#DC2626]">
        Deactivated
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
      online ? "bg-[#16A34A]/10 text-[#16A34A]" : "bg-[#A0A0A0]/15 text-[#6b6b6b]"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-[#16A34A]" : "bg-[#A0A0A0]"}`} />
      {online ? "Online" : "Offline"}
    </span>
  );
}

// ─── Dialog shell ───────────────────────────────────────────────────────────

function DialogShell({
  title, subtitle, onClose, children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(30,30,30,0.55)", backdropFilter: "blur(4px)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        style={{ fontFamily: "'Inter',sans-serif" }}>
        <div className="bg-[#344248] px-6 py-5 flex items-start justify-between shrink-0">
          <div>
            <h2 style={{ fontFamily: "'Cinzel',serif" }} className="text-lg font-bold text-white leading-tight">
              {title}
            </h2>
            <p className="text-white/60 text-xs mt-1">{subtitle}</p>
          </div>
          <button onClick={onClose} aria-label="Close dialog"
            className="text-white/50 hover:text-white transition-colors mt-0.5 shrink-0 ml-4">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

// `placeholder:` is set explicitly: with the browser default the grey was dark
// enough that staff read the example values as pre-filled data.
const fieldClass =
  "w-full border border-black/15 rounded-lg px-3.5 py-2.5 text-sm bg-[#f5f5f5] outline-none placeholder:text-[#A0A0A0] placeholder:font-normal focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20";

// ─── Add client ─────────────────────────────────────────────────────────────

function AddClientDialog({
  onClose, onCreate, onCreated,
}: {
  onClose: () => void;
  onCreate: (input: {
    email: string; fullName: string; phone?: string | null;
    notes?: string | null; password?: string;
  }) => Promise<void>;
  onCreated: (message: string) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const problem =
      validateFullName(fullName) ??
      validateEmail(email) ??
      validatePhone(phone) ??
      (password.trim() ? validatePassword(password.trim()) : null);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        email: email.trim(),
        fullName: fullName.trim(),
        phone: phone.trim() ? normalizePhone(phone) : null,
        notes: notes.trim() || null,
        password: password.trim() || undefined,
      });
      onCreated(
        password.trim()
          ? `${fullName} can now sign in with the password you set.`
          : `${fullName} has been added. A set-password email was sent to ${email}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the account.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell title="Add Client" subtitle="Create a portal account for a walk-in client." onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div>
          <label htmlFor="ac-name" className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">Full Name</label>
          <input id="ac-name" value={fullName} onChange={(e) => setFullName(e.target.value)}
            placeholder="Enter full legal name" className={fieldClass} />
        </div>
        <div>
          <label htmlFor="ac-email" className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">Email</label>
          <input id="ac-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address" className={fieldClass} />
        </div>
        <div>
          <label htmlFor="ac-phone" className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">
            Mobile <span className="text-[#A0A0A0] font-normal">(optional)</span>
          </label>
          <input id="ac-phone" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="+639XXXXXXXXX" className={fieldClass} />
        </div>
        <div>
          <label htmlFor="ac-pass" className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">
            Temporary Password <span className="text-[#A0A0A0] font-normal">(optional)</span>
          </label>
          <input id="ac-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to email a set-password link" className={fieldClass} />
          <p className="text-[10px] text-[#6b6b6b] mt-1.5 leading-relaxed">
            Use a strong password (8+ characters, upper and lower case, a number and a symbol) to hand the client at the counter, or leave it blank
            and the portal emails them a link to choose their own.
          </p>
        </div>
        <div>
          <label htmlFor="ac-notes" className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">
            Office Notes <span className="text-[#A0A0A0] font-normal">(staff only)</span>
          </label>
          <textarea id="ac-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="Enter any office notes (optional)" className={`${fieldClass} resize-none`} />
        </div>

        {error && <ErrorBanner message={error} />}

        <button type="submit" disabled={saving}
          className="w-full bg-[#8A1C1F] text-white py-3 rounded-lg font-semibold text-sm hover:bg-[#6d1518] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? "Creating account…" : "Create Account"}
        </button>
      </form>
    </DialogShell>
  );
}

// ─── Edit client ────────────────────────────────────────────────────────────

function EditClientDialog({
  client, onClose, onSave, onSaved,
}: {
  client: ClientSummary;
  onClose: () => void;
  onSave: (
    id: string,
    patch: { full_name?: string; phone?: string | null; notes?: string | null },
  ) => Promise<void>;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(client.full_name);
  const [phone, setPhone] = useState(client.phone ?? "");
  const [notes, setNotes] = useState(client.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const problem = validateFullName(fullName) ?? validatePhone(phone);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await onSave(client.id, {
        full_name: fullName.trim(),
        phone: phone.trim() ? normalizePhone(phone) : null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell title="Edit Client" subtitle={client.email} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div>
          <label htmlFor="ec-name" className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">Full Name</label>
          <input id="ec-name" value={fullName} onChange={(e) => setFullName(e.target.value)}
            className={fieldClass} />
        </div>
        <div>
          <label htmlFor="ec-phone" className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">Mobile</label>
          <input id="ec-phone" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="+639XXXXXXXXX" className={fieldClass} />
        </div>
        <div>
          <label htmlFor="ec-notes" className="block text-xs font-semibold text-[#1E1E1E] mb-1.5">Office Notes</label>
          <textarea id="ec-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            className={`${fieldClass} resize-none`} />
        </div>

        <p className="text-[10px] text-[#6b6b6b]">
          Email addresses are changed by the client from their own profile, so the
          login and the record never drift apart.
        </p>

        {error && <ErrorBanner message={error} />}

        <button type="submit" disabled={saving}
          className="w-full bg-[#8A1C1F] text-white py-3 rounded-lg font-semibold text-sm hover:bg-[#6d1518] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save Changes
        </button>
      </form>
    </DialogShell>
  );
}
