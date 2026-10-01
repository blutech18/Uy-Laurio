import { CheckCircle, Circle } from "lucide-react";

import { passwordChecks } from "@/lib/validation";

/** Live checklist shown under a new-password field. */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) {
    return (
      <p className="text-[11px] text-[#6b6b6b] mt-1.5">
        Use a strong password: 8+ characters with uppercase, lowercase, a number and a symbol.
      </p>
    );
  }
  return (
    <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
      {passwordChecks(password).map((c) => (
        <li key={c.label}
          className={`flex items-center gap-1.5 text-[11px] font-medium ${c.ok ? "text-[#16A34A]" : "text-[#6b6b6b]"}`}>
          {c.ok ? <CheckCircle size={11} /> : <Circle size={11} />}
          {c.label}
        </li>
      ))}
    </ul>
  );
}
