import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";

import { EmptyState, ErrorBanner, Spinner } from "@/app/components/shared/States";
import { formatDateTime, moduleLabel } from "@/lib/format";
import { reportsService } from "@/services/reports.service";
import { DB_STATUS_LABEL, type DbCaseStatus } from "@/types/models";

type ReportKind = "summary" | "transactions" | "activity" | "notifications";

const REPORTS: { id: ReportKind; label: string; blurb: string; file: string }[] = [
  { id: "summary",       label: "Service Summary",  blurb: "Case volume and turnaround by service and status.", file: "service-summary" },
  { id: "transactions",  label: "Transaction Log",  blurb: "Row-level record of every filed transaction.",      file: "transaction-log" },
  { id: "activity",      label: "System Activity",  blurb: "Who did what, and when.",                            file: "activity-log" },
  { id: "notifications", label: "Notification Log", blurb: "Outbound email traffic and delivery results.",   file: "notification-log" },
];

/** First day of the current month, as YYYY-MM-DD. */
function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Report generation for staff. Each report is a security-definer RPC that
 * checks `is_admin()` first, so a client account gets an error rather than
 * data. Rows are rendered as-is and exported to CSV in the browser.
 */
export function AdminReports() {
  const [kind, setKind] = useState<ReportKind>("summary");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    const range = { from, to };
    try {
      let result: unknown[] = [];
      if (kind === "summary")            result = await reportsService.serviceSummary(range);
      else if (kind === "transactions")  result = await reportsService.transactionLog(range);
      else if (kind === "activity")      result = await reportsService.activityLog(range);
      else                               result = await reportsService.notificationLog(range);
      setRows(result as Record<string, unknown>[]);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Could not generate the report.");
    } finally {
      setLoading(false);
    }
  }, [kind, from, to]);

  useEffect(() => {
    void run();
  }, [run]);

  const active = REPORTS.find((r) => r.id === kind)!;

  const download = () => {
    reportsService.download(`uy-laurio-${active.file}-${from}-to-${to}.csv`, rows);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F4F5F7]" style={{ fontFamily: "'Poppins',sans-serif" }}>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 style={{ fontFamily: "'Cinzel',serif" }} className="text-2xl font-bold text-[#1E1E1E] mb-1">
          Reports
        </h1>
        <p className="text-sm text-[#6b6b6b] mb-6">
          Service reports, transaction history and system activity logs.
        </p>

        {/* Report picker */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {REPORTS.map((r) => (
            <button key={r.id} onClick={() => setKind(r.id)}
              aria-pressed={kind === r.id}
              className={`text-left px-4 py-3.5 rounded-xl border-2 transition-all ${
                kind === r.id
                  ? "border-[#8A1C1F] bg-[#8A1C1F]/4"
                  : "border-black/8 bg-white hover:border-black/20"
              }`}>
              <p className={`text-sm font-semibold ${kind === r.id ? "text-[#8A1C1F]" : "text-[#1E1E1E]"}`}>
                {r.label}
              </p>
              <p className="text-[10px] text-[#6b6b6b] mt-0.5 leading-relaxed">{r.blurb}</p>
            </button>
          ))}
        </div>

        {/* Range + actions */}
        <div className="bg-white rounded-xl border border-black/8 shadow-sm p-4 mb-5 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="rp-from" className="block text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide mb-1.5">
              From
            </label>
            <input id="rp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-black/15 rounded-lg px-3 py-2 text-sm bg-[#f5f5f5] outline-none focus:border-[#8A1C1F]" />
          </div>
          <div>
            <label htmlFor="rp-to" className="block text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide mb-1.5">
              To
            </label>
            <input id="rp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-black/15 rounded-lg px-3 py-2 text-sm bg-[#f5f5f5] outline-none focus:border-[#8A1C1F]" />
          </div>
          <button onClick={() => void run()} disabled={loading}
            className="flex items-center gap-2 border border-black/15 text-[#344248] text-xs font-semibold px-4 py-2.5 rounded-lg hover:bg-[#f0f0f0] transition-colors disabled:opacity-60">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Generate
          </button>
          <button onClick={download} disabled={loading || rows.length === 0}
            className="flex items-center gap-2 bg-[#344248] text-white text-xs font-semibold px-4 py-2.5 rounded-lg hover:bg-[#2a3540] transition-colors disabled:opacity-60 disabled:cursor-not-allowed ml-auto">
            <Download size={13} /> Export CSV
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        {/* Result */}
        <div className="bg-white rounded-xl border border-black/8 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-black/6 flex items-center justify-between">
            <h2 style={{ fontFamily: "'Cinzel',serif" }} className="font-bold text-[#1E1E1E] text-sm">
              {active.label}
            </h2>
            <span className="text-xs text-[#6b6b6b]">
              {loading ? "…" : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {loading ? (
            <Spinner label="Generating report…" />
          ) : rows.length === 0 ? (
            <EmptyState message="No records fall inside this date range." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#FDFDFD] border-b border-black/6">
                  <tr className="text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide">
                    {Object.keys(rows[0]).map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 whitespace-nowrap">
                        {h.replace(/_/g, " ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {rows.map((row, i) => (
                    <tr key={i} className="hover:bg-[#FDFDFD] transition-colors">
                      {Object.keys(rows[0]).map((h) => (
                        <td key={h} className="px-4 py-3 text-xs text-[#1E1E1E] align-top max-w-xs">
                          {renderCell(h, row[h])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[10px] text-[#A0A0A0] mt-4">
          Exports are generated in your browser from the same query shown above,
          so the CSV always matches what is on screen.
        </p>
      </div>
    </div>
  );
}

/** Presents raw RPC values in office language rather than database codes. */
function renderCell(column: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";

  if (column === "module") return moduleLabel(String(value) as never);
  if (column === "status") return DB_STATUS_LABEL[String(value) as DbCaseStatus] ?? String(value);

  if (column.endsWith("_at") || column === "filed_at") {
    return formatDateTime(String(value));
  }

  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
