/**
 * Tracks whether someone has signed in on this device before, so the portal can
 * greet a first-time user differently from a returning one.
 *
 * Why not derive this from the auth timestamps? `last_sign_in_at` equals
 * `created_at` only when the account is used immediately after signing up. With
 * email confirmation switched on a user typically confirms minutes or hours
 * later, which would make a genuine first login look like a return visit. A
 * local marker written the first time we greet the account is both simpler and
 * correct for the case the client actually described.
 *
 * localStorage can throw (private mode, disabled storage), so every access is
 * guarded and failures fall back to "returning" — the less surprising default.
 */

const ACCOUNT_PREFIX = "ul.greeted.";
const DEVICE_KEY = "ul.hasSignedIn";

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — greeting simply falls back to "welcome back" */
  }
}

/**
 * True the first time this account is seen on this device. Records the visit,
 * so every later call for the same account returns false.
 */
export function claimFirstVisit(userId: string): boolean {
  const key = ACCOUNT_PREFIX + userId;
  if (readKey(key) !== null) return false;
  writeKey(key, new Date().toISOString());
  return true;
}

/** True once any account has successfully signed in on this device. */
export function hasSignedInBefore(): boolean {
  return readKey(DEVICE_KEY) !== null;
}

/** Called when a session is established, so the sign-in screen can adapt. */
export function rememberSignedIn(): void {
  if (readKey(DEVICE_KEY) === null) writeKey(DEVICE_KEY, new Date().toISOString());
}
