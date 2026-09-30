import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CLAIM_WINDOW_MS } from "@/lib/scheduler/schedule";
import {
  DashboardGroupsList,
  DashboardGroupsListFallback,
} from "@/components/dashboard-groups-list";
import PageHeading from "@/components/ui/page-heading";
import { Card } from "@/components/ui/card";

const dateFormat = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function DashboardPage() {
  const supabase = await createClient();
  // Three independent reads, one round trip. The schedule queries are scoped to
  // `active` rows: a paused schedule has no meaningful next run, and a `done`
  // one is in the past, so neither belongs in "what happens next".
  const [
    { count },
    { data: bot },
    upcoming,
    failedCount,
    staleCount,
  ] = await Promise.all([
    supabase
      .from("telegram_chats")
      .select("id", { count: "exact", head: true }),
    supabase.from("telegram_bot").select("bot_username").maybeSingle(),
    supabase
      .from("scheduled_messages")
      .select("id, title, next_run_at")
      .eq("status", "active")
      .order("next_run_at", { ascending: true })
      .limit(3),
    supabase
      .from("scheduled_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    // An active row whose next_run_at is more than one claim window in the past
    // is the signature of a scheduler that is not running on this deployment.
    supabase
      .from("scheduled_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .lt(
        "next_run_at",
        new Date(Date.now() - CLAIM_WINDOW_MS).toISOString(),
      ),
  ]);

  const next = upcoming.data?.[0];
  const failed = failedCount.count ?? 0;
  const overdueCount = staleCount.count ?? 0;

  return (
    <>
      <PageHeading
        title="لوحة التحكم"
        preTitle="نظرة عامة"
        description="حالة البوت، والرسالة التالية المجدولة، وأي جدولة تعذّر إرسالها."
        link="/dashboard/send"
        linkText="إرسال رسالة"
      />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-[15px] text-[var(--muted)]">البوت</p>
          {/* One source of truth. These used to be derived separately, so a row
              with a null bot_username rendered "غير متصل" here and "متصل" in
              the status card beside it. */}
          <p className="mt-2 font-medium text-base">
            {bot?.bot_username ? `@${bot.bot_username}` : "غير متصل"}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[15px] text-[var(--muted)]">المجموعات</p>
          <p className="mt-2 text-2xl font-semibold">{count ?? 0}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[15px] text-[var(--muted)]">الحالة</p>
          <p className="mt-2 font-medium text-base">
            {bot?.bot_username ? "متصل" : "يتطلب الإعداد"}
          </p>
        </Card>

        {/* The question an admin actually opens the dashboard to ask. A failed
            schedule was previously invisible until /dashboard/schedule was
            opened, so a dead recurring send could sit unnoticed for weeks. */}
        <Card className="p-5">
          <p className="text-[15px] text-[var(--muted)]">الجدولة القادمة</p>
          {next ? (
            <>
              <p className="mt-2 truncate font-medium text-base">
                {next.title}
              </p>
              <p className="mt-1 text-[14px] text-[var(--muted)]">
                {dateFormat.format(new Date(next.next_run_at))}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 font-medium text-base">لا توجد جداول نشطة</p>
              <Link
                href="/dashboard/schedule"
                className="mt-1 inline-block text-[14px] font-medium text-[var(--accent)] hover:underline"
              >
                أنشئ جدولة
              </Link>
            </>
          )}
        </Card>

        {failed > 0 ? (
          <Card className="border-[var(--danger)]/40 p-5 sm:col-span-2 lg:col-span-1">
            <p className="flex items-center gap-2 text-[15px] text-[var(--danger)]">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              جدولات متعثرة
            </p>
            <p className="mt-2 text-2xl font-semibold text-[var(--danger)]">
              {failed}
            </p>
            <Link
              href="/dashboard/schedule"
              className="mt-1 inline-block text-[14px] font-medium text-[var(--danger)] hover:underline"
            >
              راجع سبب التعثر
            </Link>
          </Card>
        ) : (
          <Card className="p-5">
            <p className="text-[15px] text-[var(--muted)]">جدولات متعثرة</p>
            <p className="mt-2 font-medium text-base text-[var(--success)]">
              لا شيء
            </p>
          </Card>
        )}
      </div>

      {/* A due schedule whose 5-minute claim window has passed means the ticker
          is not running on this deployment — a silent stall otherwise. */}
      {overdueCount > 0 && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-bg)] p-4 text-[15px] text-[var(--danger)]">
          <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
          {overdueCount === 1
            ? "جدولة واحدة تجاوزت موعدها ولم تُرسل. تحقق من عمل مشغّل الجدولة."
            : `${overdueCount} جدولات تجاوزت موعدها ولم تُرسل. تحقق من عمل مشغّل الجدولة.`}
        </p>
      )}

      <Suspense fallback={<DashboardGroupsListFallback />}>
        <DashboardGroupsList />
      </Suspense>
    </>
  );
}
