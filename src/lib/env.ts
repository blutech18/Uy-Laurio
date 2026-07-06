/**
 * Centralised, validated access to build-time environment variables.
 *
 * Vite only exposes variables prefixed with `VITE_` to the client bundle.
 * The Supabase anon key is designed to be public — real authorization is
 * enforced by Row Level Security in the database, never by hiding this key.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "" || value.startsWith("your_")) {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Copy .env.example to .env and fill in your Supabase project values.`,
    );
  }
  return value;
}

// Supabase exposes this key under two names depending on dashboard version:
// the classic "anon" key and the newer "publishable" key (sb_publishable_...).
// Both play the same public role, so accept either.
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const env = {
  supabaseUrl: required("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required(
    "VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY",
    supabaseKey,
  ),
} as const;
