import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envForSupabase } from "@/lib/supabase/server";

let cached: SupabaseClient | undefined;

export function createServiceClient() {
  if (!cached) {
    const { url } = envForSupabase();
    const key = process.env.TELEX_SERVICE_ROLE_KEY;
    if (!key)
      throw new Error(
        "TELEX_SERVICE_ROLE_KEY is not configured (server-side only).",
      );
    cached = createClient(url, key, {
      auth: { persistSession: false },
    }) as SupabaseClient;
  }
  return cached;
}

// A throwaway, un-cached client used for one job: proving a password without
// disturbing the caller's session. Reusing the cookie client for
// signInWithPassword would REPLACE the session cookie with a fresh aal1 one —
// silently demoting an aal2 admin who is only trying to change their password
// (and locking them out of their own dashboard, since requireAdmin() then
// demands the second factor again).
//
// Deliberately built on the anon key, not the service key: the transient
// session it earns is a normal user session, so even if it leaked it would be
// RLS-limited to that user. persistSession:false means no cookies, no storage,
// nothing to clean up beyond the in-memory token the caller must sign out.
export function createTransientAuthClient(): SupabaseClient {
  const { url, anonKey } = envForSupabase();
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as SupabaseClient;
}