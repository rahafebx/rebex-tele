import type { createClient } from "@/lib/supabase/server";

// TOTP (authenticator app) MFA state, read through the cookie session client.
//
// Why this module exists: Supabase tracks an "authenticator assurance level"
// (AAL) on the session itself. A password sign-in yields aal1; verifying a
// second factor promotes the *session* to aal2. That means "the admin has MFA
// enrolled" and "this request proved it" are two different questions, and
// conflating them is how a half-protected admin panel happens: the server
// must ask for the code on every new session, not just the first one.
//
// Failure posture: FAIL CLOSED. Every helper returns null/empty on an auth
// error and the caller treats that as "state unknown" → deny.

type SessionClient = Awaited<ReturnType<typeof createClient>>;

export type MfaFactor = {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
  created_at: string;
  updated_at?: string;
};

export type MfaState = {
  /** AAL claim of the current session ("aal1" | "aal2" | null). */
  aal: string | null;
  /** Id of a verified TOTP factor, or null when the admin has none. */
  verifiedFactorId: string | null;
};

// Supabase splits listFactors() into `all` (every factor, verified or not) and
// one bucket per type that holds ONLY verified ones — see _listFactors in
// auth-js, which pushes into a type bucket only when status === 'verified'.
// Unverified factors, i.e. exactly the pending ones `mfa.enroll()` just created,
// therefore exist only in `all`, so that is the single bucket this module
// reads; everything else is filtered by hand.
export async function listAllFactors(
  supabase: SessionClient,
): Promise<MfaFactor[] | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return null;
  const all = (data?.all ?? []) as MfaFactor[];
  // Newest first: an abandoned enrollment must not shadow the one the admin just
  // started (Supabase keeps unverified factors around until they're verified or
  // unenrolled, and the enrollment UI walks the user through a single attempt).
  return [...all].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function listTotpFactors(
  supabase: SessionClient,
  status: "verified" | "unverified",
): Promise<MfaFactor[] | null> {
  const all = await listAllFactors(supabase);
  if (all === null) return null;
  return all.filter(
    (factor) => factor.factor_type === "totp" && factor.status === status,
  );
}

export async function listVerifiedTotpFactors(
  supabase: SessionClient,
): Promise<MfaFactor[] | null> {
  return listTotpFactors(supabase, "verified");
}

export async function listUnverifiedTotpFactors(
  supabase: SessionClient,
): Promise<MfaFactor[] | null> {
  return listTotpFactors(supabase, "unverified");
}

// The AAL claim is read straight from the session JWT (no round trip), so an
// aal2 session costs nothing. An aal1 session can't be trusted on that claim
// alone: the session's cached user object can predate the enrollment (it
// refreshes with the access token), so a verified factor is confirmed against
// the factors endpoint before the request is let through.
export async function readMfaState(
  supabase: SessionClient,
): Promise<MfaState | null> {
  const { data: aal, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return null;
  const level = aal?.currentLevel ?? null;
  if (level === "aal2") return { aal: level, verifiedFactorId: null };
  const factors = await listVerifiedTotpFactors(supabase);
  if (factors === null) return null;
  return { aal: level, verifiedFactorId: factors[0]?.id ?? null };
}

// True when this request may proceed. aal1 is only acceptable when the admin
// has NOT enrolled any verified factor — that is the pre-MFA state, where
// requiring a code would lock them out forever (no code exists to enter).
export function mfaSatisfied(state: MfaState | null): boolean {
  if (!state) return false; // unknown state → deny
  if (state.aal === "aal2") return true;
  if (state.aal !== "aal1") return false;
  return state.verifiedFactorId === null;
}

// Step-up check for MFA management (disabling a factor): GoTrue rejects those
// with a raw "insufficient_aal" for any session that hasn't proven the second
// factor. Checking here first turns that into a clear Arabic message — and,
// like everything else here, denies when the state can't be read.
export async function hasAal2Session(
  supabase: SessionClient,
): Promise<boolean> {
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return false;
  return data?.currentLevel === "aal2";
}
