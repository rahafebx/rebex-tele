import { createServiceClient } from "@/lib/supabase/service";
import { hashIp, hashUa } from "@/lib/hash";

// Audit logging for auth, MFA, and sensitive admin actions (migration 013).
//
// Contract:
//   - Best-effort. It NEVER throws and never fails the request that triggered
//     it; a broken audit path degrades to a console warning.
//   - Hashes only. IPs and user agents are digested (lib/hash.ts) before they
//     leave this module; no raw values are ever written.
//   - No PII in `meta` either — callers pass booleans, counts, and enums.
//   - Whitelisted events only, mirroring the SQL CHECK constraint, so a typo
//     drops the row loudly instead of writing a junk event.
//
// Writes go through the service-role client: this is a sanctioned call site
// (see AGENTS.md) because a failed sign-in has no session yet, and the RPC's
// execute grant is `service_role`-only — a browser must never be able to forge
// rows.

const EVENT_PREFIXES = [
  "auth.",
  "admin.",
  "media.",
  "contact.",
  "settings.",
  "telegram.",
  "ai.",
  "security.",
  "app.",
  "maintenance.",
] as const;

type HeaderSource = Headers | Request | null | undefined;

type AuditOptions = {
  /** Request or headers to derive the hashed IP/UA from. */
  source?: HeaderSource;
  /** Acting admin. Defaults to null (system/anon events, e.g. a failed sign-in). */
  actorId?: string | null;
};

// Resolves a Request (read `.headers`) or an already-Headers-like object.
//
// Do NOT probe for `"headers" in source` to detect a Request: Next's
// `await headers()` returns a *sealed* ReadonlyHeaders, which is a Proxy over a
// HeadersAdapter, and HeadersAdapter itself carries a private `headers` field
// (a plain-object view of the raw Node headers). The probe therefore matches a
// ReadonlyHeaders too and hands back that plain object, which has no `.get()` —
// so `headers.get(...)` throws. Duck-type on `instanceof Headers` instead.
function headersOf(source: HeaderSource): Headers | null {
  if (!source) return null;
  if (source instanceof Headers) return source;
  const nested = (source as Request).headers;
  return nested instanceof Headers ? nested : null;
}

// First entry of x-forwarded-for is the originating client when the app sits
// behind one proxy/host. Returns null when no header is present (self-hosted
// with no proxy) — the login limiter treats that as "count by email only"
// rather than "skip the limit" (see migration 014).
export function extractRequestMeta(source?: HeaderSource): {
  ipHash: string | null;
  uaHash: string | null;
} {
  const headers = headersOf(source);
  if (!headers) return { ipHash: null, uaHash: null };
  const forwarded = headers.get("x-forwarded-for");
  const ip =
    (forwarded ? forwarded.split(",")[0]?.trim() : null) ||
    headers.get("x-real-ip")?.trim() ||
    null;
  return { ipHash: hashIp(ip), uaHash: hashUa(headers.get("user-agent")) };
}

export async function logAudit(
  event: string,
  meta: Record<string, unknown> = {},
  options: AuditOptions = {},
): Promise<void> {
  if (!EVENT_PREFIXES.some((prefix) => event.startsWith(prefix))) {
    console.warn(`audit: dropped non-whitelisted event "${event}"`);
    return;
  }
  try {
    const supabase = createServiceClient();
    const { ipHash, uaHash } = extractRequestMeta(options.source);
    const { error } = await supabase.rpc("insert_audit_log", {
      p_actor_id: options.actorId ?? null,
      p_event: event,
      p_meta: meta,
      p_ip_hash: ipHash,
      p_ua_hash: uaHash,
    });
    if (error) console.warn(`audit: ${event} failed: ${error.message}`);
  } catch (e) {
    console.warn(
      `audit: ${event} threw: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }
}

// 30-day retention (migration 015), with no cron of its own: it's piggybacked on
// dashboard page loads. The in-process hour guard keeps that to one RPC per
// instance per hour, and a serverless instance that dies mid-request simply
// skips a window — the next one picks it up. Fire and forget on purpose:
// retention must never delay or fail a page render.
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const AUDIT_RETENTION_DAYS = 30;
let lastPurgeAt = 0;

export async function maybePurgeAuditLogs(): Promise<void> {
  if (Date.now() - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = Date.now();
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("purge_audit_logs_older_than", {
      p_days: AUDIT_RETENTION_DAYS,
    });
    if (error) console.warn(`audit: retention purge failed: ${error.message}`);
  } catch {
    // best effort — see above
  }
}
