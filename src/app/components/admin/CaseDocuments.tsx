import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle, CheckCircle, Download, FileText, Flag, ImageIcon, Loader2, RefreshCw,
} from "lucide-react";

import { EmptyState, Spinner } from "@/app/components/shared/States";
import { StatusBadge } from "@/app/components/shared/StatusBadge";
import { formatBytes, formatDateTime } from "@/lib/format";
import { documentsService } from "@/services/documents.service";
import type { DocumentRecord } from "@/types/models";

/**
 * The documents a client actually submitted for a case, with per-document
 * verification.
 *
 * Two problems are addressed here. Staff could not see any uploaded file — the
 * review pane rendered a decorative placeholder page rather than the submission
 * — and nothing in the app ever called `documentsService.verify/reject`, so every
 * document kept its initial "pending" status and displayed as "Under Review"
 * forever. Approving or flagging a case only moved the *case* status; the
 * documents were never touched.
 */
export function CaseDocuments({
  caseId,
  clientName,
  onChanged,
}: {
  caseId: string;
  clientName: string;
  /** Lets the parent refresh case-level counters after a verdict. */
  onChanged?: () => void;
}) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await documentsService.listForCase(caseId);
      setDocs(rows);
      setActiveId((prev) => prev ?? rows[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the submitted documents.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    setActiveId(null);
    setPreviewUrl(null);
    void load();
  }, [load]);

  const active = docs.find((d) => d.id === activeId) ?? null;

  // Signed URLs are short-lived, so one is minted whenever the selection changes.
  useEffect(() => {
    if (!active) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError("");
    documentsService
      .getSignedUrl(active.storage_path)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch((e) => {
        if (!cancelled) {
          setPreviewUrl(null);
          setPreviewError(e instanceof Error ? e.message : "Could not open the file.");
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const verify = async (doc: DocumentRecord) => {
    setBusyId(doc.id);
    try {
      await documentsService.verify(doc.id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve the document.");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (doc: DocumentRecord) => {
    const text = reason.trim();
    if (!text) return;
    setBusyId(doc.id);
    try {
      await documentsService.reject(doc.id, text);
      setRejectingId(null);
      setReason("");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not flag the document.");
    } finally {
      setBusyId(null);
    }
  };

  const isImage = (doc: DocumentRecord) =>
    (doc.mime_type ?? "").startsWith("image/") ||
    /\.(png|jpe?g|webp|heic)$/i.test(doc.name);
  const isPdf = (doc: DocumentRecord) =>
    (doc.mime_type ?? "") === "application/pdf" || /\.pdf$/i.test(doc.name);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ── Submitted files ─────────────────────────────────────────────── */}
      <div className="bg-white border-b border-black/8">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="text-[#344248] shrink-0" />
            <h3 style={{ fontFamily: "'Cinzel',serif" }} className="text-sm font-bold text-[#1E1E1E] truncate">
              Submitted Documents
            </h3>
            <span className="text-xs text-[#6b6b6b] shrink-0">({docs.length})</span>
          </div>
          <button type="button" onClick={() => void load()}
            className="text-[#6b6b6b] hover:text-[#1E1E1E] transition-colors p-1" title="Refresh">
            <RefreshCw size={13} />
          </button>
        </div>

        {error && (
          <div className="mx-4 sm:mx-6 mb-3 flex items-start gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {loading ? (
          <Spinner label="Loading documents…" />
        ) : docs.length === 0 ? (
          <EmptyState message={`${clientName} has not uploaded any documents for this case yet.`} />
        ) : (
          <div className="max-h-56 overflow-y-auto divide-y divide-black/5">
            {docs.map((doc) => {
              const selected = doc.id === activeId;
              return (
                <div key={doc.id}
                  className={`px-4 sm:px-6 py-3 ${selected ? "bg-[#8A1C1F]/[0.04]" : "hover:bg-[#FDFDFD]"} transition-colors`}>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setActiveId(doc.id)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        selected ? "bg-[#8A1C1F]/12 text-[#8A1C1F]" : "bg-[#F4F5F7] text-[#6b6b6b]"
                      }`}>
                        {isImage(doc) ? <ImageIcon size={14} /> : <FileText size={14} />}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-xs truncate ${selected ? "font-semibold text-[#1E1E1E]" : "text-[#1E1E1E]"}`}>
                          {doc.name}
                        </p>
                        <p className="text-[10px] text-[#A0A0A0]">
                          {formatBytes(doc.size_bytes)} · {formatDateTime(doc.submitted_at)}
                        </p>
                      </div>
                    </button>

                    <StatusBadge status={doc.status} />

                    {/* Per-document verdict — this is what moves a document off
                        "Under Review". */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => void verify(doc)}
                        disabled={busyId === doc.id || doc.status === "done"}
                        title="Approve this document"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#16A34A] hover:bg-[#16A34A]/10 transition-colors disabled:opacity-35 disabled:hover:bg-transparent">
                        {busyId === doc.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={14} />}
                      </button>
                      <button type="button"
                        onClick={() => {
                          setRejectingId(rejectingId === doc.id ? null : doc.id);
                          setReason(doc.rejection_reason ?? "");
                        }}
                        title="Flag this document for re-submission"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#8A1C1F] hover:bg-[#8A1C1F]/10 transition-colors">
                        <Flag size={13} />
                      </button>
                    </div>
                  </div>

                  {doc.rejection_reason && rejectingId !== doc.id && (
                    <p className="text-[10px] text-[#DC2626] mt-1.5 ml-11">
                      Flagged: {doc.rejection_reason}
                    </p>
                  )}

                  {rejectingId === doc.id && (
                    <div className="mt-2.5 ml-11 flex flex-col sm:flex-row gap-2">
                      <input value={reason} onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason the client must re-submit"
                        className="flex-1 border border-black/15 rounded-lg px-3 py-2 text-xs bg-[#f5f5f5] outline-none placeholder:text-[#A0A0A0] focus:border-[#8A1C1F] focus:ring-2 focus:ring-[#8A1C1F]/20" />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void reject(doc)}
                          disabled={!reason.trim() || busyId === doc.id}
                          className="bg-[#8A1C1F] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#6d1518] transition-colors disabled:opacity-60">
                          Flag
                        </button>
                        <button type="button" onClick={() => { setRejectingId(null); setReason(""); }}
                          className="text-xs font-semibold text-[#6b6b6b] px-2 py-2 hover:text-[#1E1E1E]">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Preview of the selected file ────────────────────────────────── */}
      <div className="flex-1 min-h-0 bg-[#F4F5F7] p-4 sm:p-6 overflow-auto">
        {!active ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-[#6b6b6b]">Select a document to preview it.</p>
          </div>
        ) : previewLoading ? (
          <Spinner label="Opening document…" />
        ) : previewError || !previewUrl ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <AlertCircle size={22} className="text-[#DC2626]" />
            <p className="text-sm text-[#6b6b6b] max-w-sm">
              {previewError || "This file could not be opened."}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-black/10 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-black/8 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-[#344248] truncate">{active.name}</p>
              <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8A1C1F] hover:underline shrink-0">
                <Download size={12} /> Open
              </a>
            </div>

            {isImage(active) ? (
              <img src={previewUrl} alt={active.name}
                className="w-full max-h-[62vh] object-contain bg-[#FDFDFD]" />
            ) : isPdf(active) ? (
              <iframe src={previewUrl} title={active.name} className="w-full h-[62vh] bg-[#FDFDFD]" />
            ) : (
              <div className="p-10 flex flex-col items-center gap-3 text-center">
                <FileText size={26} className="text-[#8A1C1F]" />
                <p className="text-sm text-[#6b6b6b]">
                  This file type cannot be previewed in the browser. Use “Open” to download it.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
