import { AlertCircle, Inbox, Loader2 } from "lucide-react";

/** Inline async placeholder used by every data surface. */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[#6b6b6b] text-sm">
      <Loader2 size={16} className="animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-[#6b6b6b]">
      <Inbox size={22} className="text-[#A0A0A0]" />
      <p className="text-xs">{message}</p>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-6 flex items-center gap-2 text-[#DC2626] text-xs bg-[#DC2626]/8 border border-[#DC2626]/20 rounded-xl px-3.5 py-3"
    >
      <AlertCircle size={13} className="shrink-0" /> {message}
    </div>
  );
}
