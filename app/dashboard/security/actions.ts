"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createTransientAuthClient } from "@/lib/supabase/service";
import { requireAdmin, ADMIN_ERROR } from "@/lib/supabase/admin";
import {
  hasAal2Session,
  listAllFactors,
  listUnverifiedTotpFactors,
  listVerifiedTotpFactors,
} from "@/lib/supabase/mfa";
import { logAudit } from "@/lib/audit";

const MFA_STATE_ERROR = "تعذّر قراءة حالة المصادقة الثنائية. أعد تحميل الصفحة وحاول مجددًا.";
const MFA_INVALID = "رمز التحقق غير صحيح.";
const MFA_ALREADY_ON = "المصادقة الثنائية مفعّلة بالفعل.";
const MFA_NEEDS_AAL2 =
  "يلزم جلسة مُتحقَّق منها بخطوتين لإيقاف المصادقة الثنائية. سجّل الدخول من جديد وأدخل رمز التحقق.";
const MFA_NOT_ENROLLED = "لا يوجد عامل مصادقة ثنائية مفعّل.";
const MFA_FACTOR_NOT_FOUND = "عامل المصادقة الثنائية غير موجود.";
const PASSWORD_CURRENT_WRONG = "كلمة المرور الحالية غير صحيحة.";
const PASSWORD_REAUTH =
  "لإتمام تغيير كلمة المرور يلزم إعادة تسجيل الدخول ثم إعادة المحاولة.";
const PASSWORD_SAME = "كلمة المرور الجديدة مطابقة للحالية.";
const PASSWORD_TOO_SHORT = "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.";

// ASCII only: the issuer/friendly name end up in the otpauth:// URI, and some
// authenticator apps mangle non-ASCII labels. The UI around it is Arabic.
const MFA_ISSUER = "Rebex Tele";
const MFA_FACTOR_NAME = "Authenticator";

const MIN_PASSWORD_LENGTH = 8;

function authErrorMessage(code?: string): string {
  switch (code) {
    case "mfa_totp_enroll_not_enabled":
    case "mfa_totp_verify_not_enabled":
      return "المصادقة الثنائية (TOTP) غير مفعّلة في مشروع Supabase. فعّلها من Authentication ← MFA ثم أعد المحاولة.";
    case "too_many_enrolled_mfa_factors":
      return "بلغت الحد الأقصى للعوامل المسجّلة. احذف عاملًا قديمًا أولًا.";
    case "mfa_factor_name_conflict":
      return "يوجد عامل مسجّل بالاسم نفسه. احذفه من القائمة ثم أعد المحاولة.";
    case "mfa_factor_not_found":
      return MFA_FACTOR_NOT_FOUND;
    case "insufficient_aal":
      return MFA_NEEDS_AAL2;
    case "mfa_verification_failed":
    case "mfa_challenge_expired":
    case "mfa_verification_rejected":
      return MFA_INVALID;
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return PASSWORD_REAUTH;
    case "same_password":
      return PASSWORD_SAME;
    case "weak_password":
      return PASSWORD_TOO_SHORT;
    default:
      return "تعذّر إتمام العملية. حاول مجددًا.";
  }
}

// Step 1 of enrollment: Supabase creates an UNVERIFIED factor and hands back a
// QR code (data URL), the base32 secret, and the otpauth URI. All three are
// returned to the browser exactly once and never logged.
export async function startMfaEnrollment() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };

  const verified = await listVerifiedTotpFactors(supabase);
  if (verified === null) return { error: MFA_STATE_ERROR };
  if (verified.length > 0) return { error: MFA_ALREADY_ON };

  // Drop factors left behind by an abandoned attempt. Unverified factors are
  // removable at aal1, and clearing them avoids "name conflict" / "too many
  // factors" failures on a retry.
  const stale = await listUnverifiedTotpFactors(supabase);
  if (stale === null) return { error: MFA_STATE_ERROR };
  for (const factor of stale ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: MFA_FACTOR_NAME,
    issuer: MFA_ISSUER,
  });
  if (error || !data) {
    await logAudit(
      "auth.mfa.enroll_failed",
      { reason: error?.code ?? "unknown" },
      { source: await headers(), actorId: admin.user.id },
    );
    return { error: authErrorMessage(error?.code) };
  }

  await logAudit(
    "auth.mfa.enroll_started",
    { factor_type: "totp" },
    { source: await headers(), actorId: admin.user.id },
  );
  return {
    ok: true,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

// Step 2: the admin enters a code from their app, which verifies the factor and
// promotes the session to aal2 (and revokes the admin's other sessions).
export async function verifyMfaEnrollment(formData: FormData) {
  const code = String(formData.get("code") ?? "").replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "أدخل رمز تحقق مكوّنًا من 6 أرقام." };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };

  const pending = await listUnverifiedTotpFactors(supabase);
  if (pending === null) return { error: MFA_STATE_ERROR };
  const factor = pending[0];
  if (!factor)
    return {
      error: "انتهت صلاحية عملية التسجيل. ابدأ التسجيل من جديد.",
    };

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });
  if (error) {
    await logAudit(
      "auth.mfa.verify_failed",
      { stage: "enroll" },
      { source: await headers(), actorId: admin.user.id },
    );
    return { error: error.code ? authErrorMessage(error.code) : MFA_INVALID };
  }

  await logAudit(
    "auth.mfa.enrolled",
    { factor_type: "totp" },
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard/security");
  revalidatePath("/dashboard");
  return { ok: true };
}

// Removing the factor is the documented recovery path when the authenticator
// device is lost, so it demands a session that has already proven a code —
// otherwise a walk-up attacker on an unlocked browser could switch MFA off.
export async function unenrollMfa() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  if (!(await hasAal2Session(supabase))) return { error: MFA_NEEDS_AAL2 };

  const factors = await listVerifiedTotpFactors(supabase);
  if (factors === null) return { error: MFA_STATE_ERROR };
  if (factors.length === 0) return { error: MFA_NOT_ENROLLED };

  for (const factor of factors) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return { error: authErrorMessage(error.code) };
  }

  await logAudit(
    "auth.mfa.unenrolled",
    { count: factors.length },
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard/security");
  revalidatePath("/dashboard");
  return { ok: true };
}

// Remove one specific factor. This is the escape hatch for a half-finished
// enrollment: Supabase keeps unverified factors until they're verified or
// unenrolled, and a leftover one blocks the next attempt (friendly-name
// conflict, since "Authenticator" is the name we always request). Verified
// factors need a session that already proved a code, same as unenrollMfa —
// requireAdmin() already forces aal2 whenever a verified factor exists, and the
// explicit check below only turns GoTrue's raw insufficient_aal into Arabic.
export async function deleteMfaFactor(factorId: string) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(factorId))
    return { error: MFA_FACTOR_NOT_FOUND };

  // Resolved from our own list rather than passed straight to the API, so the
  // id can only ever name a factor this admin actually owns, and so we know
  // whether a code has to be proven first.
  const factors = await listAllFactors(supabase);
  if (factors === null) return { error: MFA_STATE_ERROR };
  const factor = factors.find((f) => f.id === factorId);
  if (!factor) return { error: MFA_FACTOR_NOT_FOUND };
  if (factor.status === "verified" && !(await hasAal2Session(supabase)))
    return { error: MFA_NEEDS_AAL2 };

  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { error: authErrorMessage(error.code) };

  await logAudit(
    "auth.mfa.factor_deleted",
    {
      factor_type: factor.factor_type,
      was_verified: factor.status === "verified",
    },
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard/security");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function changePassword(formData: FormData) {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword)
    return { error: "كلمتا المرور الجديدتان غير متطابقتين." };
  if (newPassword.length < MIN_PASSWORD_LENGTH)
    return { error: PASSWORD_TOO_SHORT };
  if (newPassword === currentPassword) return { error: PASSWORD_SAME };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  if (!currentPassword) return { error: PASSWORD_CURRENT_WRONG };

  // Prove the current password on a throwaway client (see
  // createTransientAuthClient) so this session's aal2 state survives.
  const verifier = createTransientAuthClient();
  const { data: verified, error: verifyError } =
    await verifier.auth.signInWithPassword({
      email: admin.user.email ?? "",
      password: currentPassword,
    });
  try {
    // Drop the transient refresh token; `local` scope leaves the admin's real
    // browser session alone.
    await verifier.auth.signOut({ scope: "local" });
  } catch {
    // best effort: the client is discarded either way
  }
  if (verifyError || verified?.user?.id !== admin.user.id) {
    await logAudit(
      "auth.password.change_failed",
      { reason: "wrong_current_password" },
      { source: await headers(), actorId: admin.user.id },
    );
    return { error: PASSWORD_CURRENT_WRONG };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    await logAudit(
      "auth.password.change_failed",
      { reason: error.code ?? "unknown" },
      { source: await headers(), actorId: admin.user.id },
    );
    return { error: authErrorMessage(error.code) };
  }

  // Revoke every other session: a password change should lock out whoever else
  // might be holding one. scope "others" keeps this device signed in.
  await supabase.auth.signOut({ scope: "others" });
  await logAudit(
    "auth.password.changed",
    {},
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard/security");
  return { ok: true };
}
