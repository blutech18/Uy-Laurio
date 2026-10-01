/**
 * Input rules shared by sign-up, profile editing, password changes and the
 * admin "Add Client" form. Each validator returns an error message, or null
 * when the value is acceptable.
 *
 * A syntactic check cannot prove a mailbox exists - that is what the email
 * confirmation link is for - but it does reject the obvious junk
 * ("asd@asd", "x@gmial.com", throw-away inboxes) before an account is created.
 */

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/** Common typos of big providers, and disposable-inbox services. */
const BLOCKED_EMAIL_DOMAINS = new Set([
  "gmial.com", "gmai.com", "gmail.co", "gmail.con", "gnail.com", "gmil.com",
  "yaho.com", "yahooo.com", "yahoo.con", "hotmial.com", "hotmail.con",
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com",
  "temp-mail.org", "throwawaymail.com", "yopmail.com", "trashmail.com",
  "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc",
  "fakeinbox.com", "example.com", "test.com",
]);

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter a valid email address.";
  if (!EMAIL_RE.test(email) || email.includes("..")) {
    return "Enter a valid email address (for example, juan@gmail.com).";
  }
  const domain = email.split("@")[1].toLowerCase();
  if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
    return "That email domain looks mistyped or is not accepted. Enter a valid, active email address.";
  }
  return null;
}

/**
 * The portal needs the client's legal name, so at least two name parts are
 * required (first and last; middle name encouraged), letters only.
 */
export function validateFullName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  const parts = name.split(" ").filter(Boolean);
  if (parts.length < 2) {
    return "Enter your full legal name (first and last name, plus middle name if any).";
  }
  if (!/^[\p{L}][\p{L}\s.'’-]*$/u.test(name) || parts.some((p) => p.replace(/[.'’-]/g, "").length < 1)) {
    return "Your name may only contain letters, spaces, periods, apostrophes and hyphens.";
  }
  if (parts.filter((p) => p.replace(/[.'’-]/g, "").length >= 2).length < 2) {
    return "Enter your full legal name, not initials only.";
  }
  return null;
}

/** Accepts 09XXXXXXXXX or +639XXXXXXXXX; returns the +639 form. */
export function normalizePhone(value: string): string | null {
  const digits = value.replace(/[\s()-]/g, "");
  if (/^\+639\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

export function validatePhone(value: string, required = false): string | null {
  if (!value.trim()) return required ? "Enter your mobile number (+639XXXXXXXXX)." : null;
  return normalizePhone(value)
    ? null
    : "Enter a valid Philippine mobile number: +639XXXXXXXXX (e.g., +639123456789).";
}

export interface PasswordCheck {
  label: string;
  ok: boolean;
}

export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { label: "At least 8 characters", ok: password.length >= 8 },
    { label: "An uppercase letter",   ok: /[A-Z]/.test(password) },
    { label: "A lowercase letter",    ok: /[a-z]/.test(password) },
    { label: "A number",              ok: /\d/.test(password) },
    { label: "A symbol (e.g. ! @ # $)", ok: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function validatePassword(password: string): string | null {
  return passwordChecks(password).every((c) => c.ok)
    ? null
    : "Input a strong password: at least 8 characters with uppercase, lowercase, a number and a symbol.";
}
