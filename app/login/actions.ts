"use server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";
import {
  extractClientIp,
  isLoginBlocked,
  recordLoginAttempt,
} from "@/lib/login-limiter";
import { listVerifiedTotpFactors } from "@/lib/supabase/mfa";

// Deliberately generic: never reveal whether the email exists or surface raw
// Supabase errors (which can leak auth misconfiguration details).
const LOGIN_FAILED = "بيانات الدخول غير صحيحة.";
const LOGIN_BLOCKED = "محاولات كثيرة جدًا، حاول بعد قليل.";
const MFA_INVALID = "رمز التحقق غير صحيح.";
const MFA_SESSION_GONE = "انتهت جلسة الدخول. سجّل الدخول من جديد.";

const CODE_RE = /^\d{6}$/;

function toLogin(params: { step?: string; error?: string }) {
  const query = new URLSearchParams();
  if (params.step) query.set("step", params.step);
  if (params.error) query.set("error", params.error);
  const qs = query.toString();
  return `/login${qs ? `?${qs}` : ""}`;
}

// Bookkeeping for a *completed* sign-in, shared by both steps so the
// password-only path and the MFA path can't drift apart. Only called once the
// admin is genuinely at aal2-or-no-mfa.
async function completeSignIn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email?: string | null },
  opts: { mfa: boolean; ip: string | null; reqHeaders: Headers },
) {
  await recordLoginAttempt(user.email ?? "", opts.ip, true);
  await logAudit(
    "auth.signin.success",
    { mfa: opts.mfa },
    { source: opts.reqHeaders, actorId: user.id },
  );
  await supabase.from("admin_last_login").upsert(
    {
      singleton: true,
      email: user.email ?? "",
      last_login_at: new Date().toISOString(),
    },
    { onConflict: "singleton" },
  );
}

// Two-step sign-in: credentials, then — only when a factor is enrolled — a
// TOTP code. A password sign-in yields an aal1 session, so while MFA is
// enrolled it is NOT a completed login: admin_last_login and the success audit
// wait for the code.
export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const reqHeaders = await headers();
  const ip = extractClientIp(reqHeaders);

  // Two limits, deliberately layered:
  //  - in-memory (lib/rate-limit.ts): per process, per minute, costs nothing,
  //    and keeps working when the database doesn't;
  //  - DB-backed (migration 014): survives restarts and applies across
  //    instances, and fails OPEN so a limiter outage can't lock the admin out.
  // Both are per email AND per IP, so neither spraying nor rotation is free.
  const memoryOk =
    rateLimit(`login:${email}`, 10, 60_000) &&
    rateLimit(`login:ip:${ip ?? "unknown"}`, 30, 60_000);
  if (!memoryOk) {
    await logAudit(
      "auth.signin.blocked",
      { reason: "rate_limited_memory" },
      { source: reqHeaders },
    );
    redirect(toLogin({ error: LOGIN_BLOCKED }));
  }
  if (await isLoginBlocked(email, ip)) {
    await logAudit(
      "auth.signin.blocked",
      { reason: "rate_limited" },
      { source: reqHeaders },
    );
    redirect(toLogin({ error: LOGIN_BLOCKED }));
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !user) {
    await recordLoginAttempt(email, ip, false);
    await logAudit(
      "auth.signin.failed",
      { reason: "credentials" },
      { source: reqHeaders },
    );
    redirect(toLogin({ error: LOGIN_FAILED }));
  }

  const factors = await listVerifiedTotpFactors(supabase);
  if (factors === null) {
    // Can't tell whether a factor is enrolled, and "can't tell" must never
    // mean "let them in": drop the half-open session and start over.
    await supabase.auth.signOut();
    await logAudit(
      "auth.signin.failed",
      { reason: "mfa_state_unavailable" },
      { source: reqHeaders, actorId: user.id },
    );
    redirect(toLogin({ error: LOGIN_FAILED }));
  }
  if (factors.length > 0) {
    // Password accepted, second factor still required. The aal1 session is
    // kept on purpose: submitMfa() needs it to verify the code.
    await logAudit(
      "auth.signin.mfa_challenge",
      {},
      { source: reqHeaders, actorId: user.id },
    );
    redirect(toLogin({ step: "mfa" }));
  }

  await completeSignIn(supabase, user, { mfa: false, ip, reqHeaders });
  redirect("/dashboard");
}

// Second step: verify a TOTP code against the pending aal1 session. The code is
// the only input; the factor comes from the session, so nothing client-supplied
// decides which factor is being answered.
export async function submitMfa(formData: FormData) {
  const code = String(formData.get("code") ?? "").replace(/[\s-]/g, "");
  if (!CODE_RE.test(code)) redirect(toLogin({ step: "mfa", error: MFA_INVALID }));

  const reqHeaders = await headers();
  const ip = extractClientIp(reqHeaders);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(toLogin({ error: MFA_SESSION_GONE }));

  // Same layered limit as the password step: a correct password must not turn
  // the code field into an unlimited guessing oracle.
  if (
    !rateLimit(`mfa:${user.id}`, 10, 60_000) ||
    (await isLoginBlocked(user.email ?? "", ip))
  ) {
    await logAudit(
      "auth.signin.blocked",
      { reason: "rate_limited_mfa" },
      { source: reqHeaders, actorId: user.id },
    );
    redirect(toLogin({ step: "mfa", error: LOGIN_BLOCKED }));
  }

  const factors = await listVerifiedTotpFactors(supabase);
  if (factors === null) {
    await supabase.auth.signOut();
    redirect(toLogin({ error: MFA_SESSION_GONE }));
  }
  const factor = factors[0];
  if (!factor) {
    // No verified factor for this session — MFA is off (so the admin belongs
    // at /dashboard) or was just removed. Never treat a code as satisfied.
    await supabase.auth.signOut();
    await logAudit(
      "auth.signin.failed",
      { reason: "no_verified_factor" },
      { source: reqHeaders, actorId: user.id },
    );
    redirect(toLogin({ error: LOGIN_FAILED }));
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });
  if (error) {
    await recordLoginAttempt(user.email ?? "", ip, false);
    await logAudit(
      "auth.signin.failed",
      { reason: "mfa" },
      { source: reqHeaders, actorId: user.id },
    );
    redirect(toLogin({ step: "mfa", error: MFA_INVALID }));
  }

  // A successful verify promotes this session to aal2 and revokes the admin's
  // other sessions (Supabase behaviour) — the cookie is rewritten in place by
  // the auth client, so the dashboard layout now passes requireAdmin().
  await completeSignIn(supabase, user, { mfa: true, ip, reqHeaders });
  redirect("/dashboard");
}
