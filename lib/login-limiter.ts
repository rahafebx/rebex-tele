import { createServiceClient } from "@/lib/supabase/service";
import { hashEmail, hashIp } from "@/lib/hash";
import { logAudit } from "@/lib/audit";

// Durable, DB-backed sign-in limiter (migration 014). The in-memory buckets in
// lib/rate-limit.ts stay as a cheap first line, but they reset on restart and
// are per-process, so on serverless they don't hold. This ledger survives both.
//
// Failure posture: FAIL OPEN. A missing migration, a bad RPC signature, or a
// service-role outage must never lock the admin out of their own dashboard —
// every error path here returns "not blocked" and records a best-effort
// audit row so the degradation is visible in the logs.
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_ATTEMPT_LIMIT = 5;

type HeaderSource = Headers | Request | null | undefined;

// Resolves a Request (read `.headers`) or an already-Headers-like object.
//
// Do NOT probe for `"headers" in source` to detect a Request: Next's
// `await headers()` returns a *sealed* ReadonlyHeaders, which is a Proxy over a
// HeadersAdapter, and HeadersAdapter itself carries a private `headers` field
// (a plain-object view of the raw Node headers). The probe therefore matches a
// ReadonlyHeaders too and hands back that plain object, which has no `.get()` —
// so `headers.get(...)` throws. Duck-type on the method we actually call.
function headersOf(source: HeaderSource): Headers | null {
  if (!source) return null;
  if (source instanceof Headers) return source;
  const nested = (source as Request).headers;
  return nested instanceof Headers ? nested : null;
}

// null when there's no proxy header (self-hosted, no reverse proxy). Callers
// pass it straight through — a null IP narrows the limit to "by email", it
// never removes the limit.
export function extractClientIp(source?: HeaderSource): string | null {
  const headers = headersOf(source);
  if (!headers) return null;
  const forwarded = headers.get("x-forwarded-for");
  return (
    (forwarded ? forwarded.split(",")[0]?.trim() : null) ||
    headers.get("x-real-ip")?.trim() ||
    null
  );
}

export async function isLoginBlocked(
  email: string,
  ip?: string | null,
): Promise<boolean> {
  const emailHash = hashEmail(email);
  if (!emailHash) return false;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("count_login_attempts", {
      p_email_hash: emailHash,
      p_ip_hash: hashIp(ip),
      p_window_minutes: LOGIN_WINDOW_MINUTES,
      p_attempt_limit: LOGIN_ATTEMPT_LIMIT,
    });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (e) {
    // fail open
    await logAudit("app.login_limiter.error", {
      stage: "count",
      detail: e instanceof Error ? e.message : "unknown error",
    });
    return false;
  }
}

export async function recordLoginAttempt(
  email: string,
  ip: string | null | undefined,
  success: boolean,
): Promise<void> {
  const emailHash = hashEmail(email);
  if (!emailHash) return;
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("login_attempts").insert({
      email_hash: emailHash,
      ip_hash: hashIp(ip),
      success,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    // fail open: an unrecorded attempt is a weaker limit, never a lockout
    await logAudit("app.login_limiter.error", {
      stage: "record",
      detail: e instanceof Error ? e.message : "unknown error",
    });
  }
}
