import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/admin";
import { listAllFactors } from "@/lib/supabase/mfa";
import { SecurityManager } from "@/components/security-manager";
import PageHeading from "@/components/ui/page-heading";

const dateFormat = new Intl.DateTimeFormat("ar", { dateStyle: "medium" });

export default async function SecurityPage() {
  // The dashboard layout already guards this route (and sends an admin who
  // still owes a TOTP code to the login step). Re-checking here keeps the page
  // safe on its own.
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) redirect("/login");

  // Every factor, not just the active TOTP one: an enrollment abandoned
  // half-way leaves an unverified factor behind, and until it is visible (and
  // deletable) the admin has no way to tell a stale one from a live one.
  const factors = await listAllFactors(supabase);
  const verified = factors?.find((f) => f.status === "verified") ?? null;
  // Dates are formatted here, not in the client component, so the server and
  // browser can't disagree on the locale and trip a hydration mismatch.
  const factorList = (factors ?? []).map((factor) => ({
    id: factor.id,
    name: factor.friendly_name ?? null,
    type: factor.factor_type,
    verified: factor.status === "verified",
    addedAt: dateFormat.format(new Date(factor.created_at)),
  }));

  return (
    <>
      <PageHeading title="الأمان" preTitle="الحساب" />
      <SecurityManager
        email={admin.user.email ?? ""}
        mfaEnrolled={Boolean(verified)}
        factorName={verified?.friendly_name ?? null}
        enrolledAt={
          verified ? dateFormat.format(new Date(verified.created_at)) : null
        }
        factors={factorList}
        factorsLoaded={factors !== null}
      />
    </>
  );
}
