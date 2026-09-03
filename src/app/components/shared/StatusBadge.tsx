import { AlertCircle, CheckCircle, Clock, Inbox } from "lucide-react";

import type { StatusKey } from "@/types/models";

/** Presentation config for the four status keys the UI renders. */
export const statusConfig: Record<StatusKey, { label: string; pill: string }> = {
  pending:  { label: "Under Review",    pill: "bg-[#A0A0A0]/15 text-[#6b6b6b]" },
  progress: { label: "In Progress",     pill: "bg-[#D97706]/12 text-[#D97706]" },
  waiting:  { label: "Action Required", pill: "bg-[#DC2626]/10 text-[#DC2626]" },
  done:     { label: "Approved",        pill: "bg-[#16A34A]/10 text-[#16A34A]" },
};

export function StatusBadge({ status }: { status: StatusKey }) {
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
