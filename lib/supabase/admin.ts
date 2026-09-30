import { createClient } from "@/lib/supabase/server";
import { mfaSatisfied, readMfaState } from "@/lib/supabase/mfa";

export const ADMIN_ERROR = "هذا الإجراء مقصور على المشرف.";

type AdminUser = { id: string; email?: string | null };
type SupabaseSessionClient = Awaited<ReturnType<typeof createClient>>;

// Why the reason matters: `/dashboard` needs to send an admin who already
// passed the password check to the TOTP step, not back to the login form
// (which would ask for the password again and lose the pending aal1 session
// the code needs). Server actions only need the boolean.
type AdminGuard =
  | { ok: true; user: AdminUser }
  | {
      ok: false;
      reason: "unauthenticated" | "not_admin" | "mfa_required";
    };

// The single authorization boundary of the app. Three checks, in order:
//   1. a real user (server-validated session, not a client-supplied claim),
//   2. that user is the admin recorded in admin_config,
//   3. MFA is satisfied for THIS request (see mfaSatisfied): once a verified
//      TOTP factor exists, an aal1 session is not enough.
//
// Step 3 is what makes MFA non-skippable: hitting a server action, an /api/*
// route or the dashboard layout with only a password session returns null
// exactly like an anonymous request does. Fails closed — if the MFA state
// can't be read (auth API error, no AAL claim), access is denied.
async function checkAdmin(
  supabase: SupabaseSessionClient,
): Promise<AdminGuard> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthenticated" };

  const { data } = await supabase
    .from("admin_config")
    .select("admin_id")
    .eq("singleton", true)
    .maybeSingle();
  if (data?.admin_id !== user.id) return { ok: false, reason: "not_admin" };

  if (!mfaSatisfied(await readMfaState(supabase)))
    return { ok: false, reason: "mfa_required" };

  return { ok: true, user };
}

export async function requireAdmin(
  supabase: SupabaseSessionClient,
): Promise<{ user: AdminUser } | null> {
  const guard = await checkAdmin(supabase);
  return guard.ok ? { user: guard.user } : null;
}

// Same decision, but it says WHY so a page/layout can route the visitor to
// the right place instead of bouncing them to a useless login form.
export async function requireAdminForPage(
  supabase: SupabaseSessionClient,
): Promise<AdminGuard> {
  return checkAdmin(supabase);
}
