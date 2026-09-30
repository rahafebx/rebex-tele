import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdminForPage } from "@/lib/supabase/admin";
import { ensureSchedulerTicker } from "@/lib/scheduler/run";
import { maybePurgeAuditLogs } from "@/lib/audit";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  ensureSchedulerTicker();
  // 30-day audit retention, piggybacked here and rate-limited in-process to one
  // attempt per hour. Not awaited: it must never delay the render.
  void maybePurgeAuditLogs();
  const supabase = await createClient();
  const guard = await requireAdminForPage(supabase);
  // A password-only session that still owes a TOTP code goes to the MFA step
  // (its aal1 session is kept on purpose) instead of the login form, which
  // would ask for the password again and drop that session.
  if (!guard.ok) {
    redirect(guard.reason === "mfa_required" ? "/login?step=mfa" : "/login");
  }
  const admin = guard;

  let lastLogin = "";
  const { data: lastLoginRow } = await supabase
    .from("admin_last_login")
    .select("last_login_at")
    .eq("singleton", true)
    .maybeSingle();
  if (lastLoginRow?.last_login_at) {
    lastLogin = new Intl.DateTimeFormat("ar", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(lastLoginRow.last_login_at));
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[300px_1fr]">
      {/* The sidebar puts 10 focusable elements (theme toggle, 8 nav items, sign
          out) ahead of the page content, so a keyboard user needs an escape
          hatch. Same component and wording as the landing page's. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:start-3 focus:z-50 focus:rounded-lg focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-[var(--accent-foreground)]"
      >
        تخطَّ إلى المحتوى
      </a>
      <Sidebar email={admin.user.email ?? ""} lastLogin={lastLogin} />
      {/* max-w-6xl matches the landing page's content column. Without it the
          list pages stretched edge to edge on a wide monitor, putting a row's
          title and its action button ~2000px apart. tabIndex is required or the
          skip link's target is not focusable and focus does not move. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl min-w-0 p-5 sm:p-8 mb-20 lg:mb-0"
      >
        {children}
      </main>
    </div>
  );
}
