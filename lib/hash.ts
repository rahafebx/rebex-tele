import { createHash } from "node:crypto";

// Privacy-preserving digests for the audit trail and the login-attempt
// ledger. IPs, user agents, and emails are never stored raw — only their
// SHA-256 hex digest. This is a re-identification barrier, not an auth
// primitive: the digests are only ever compared for equality inside a
// SECURITY DEFINER query, are never exposed to a client, and the rows behind
// them are RLS-protected (and service-role-only for login attempts). Keys
// can't be rotated without losing the corresponding history, which is the
// intended trade: an audit trail that can be silently re-keyed is worthless.

export function sha256Hex(input: string | null | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

// Emails are case-insensitive and frequently pasted with whitespace, so they
// must be normalized before hashing or the same account would get several
// distinct ledger keys.
export function hashEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value ? sha256Hex(value) : null;
}

export function hashIp(ip: string | null | undefined): string | null {
  return sha256Hex(ip);
}

export function hashUa(ua: string | null | undefined): string | null {
  return sha256Hex(ua);
}
