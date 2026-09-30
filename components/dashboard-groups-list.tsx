import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Spinner } from "@/components/spinner";
import { EmptyState } from "@/components/ui/empty-state";

export async function DashboardGroupsList() {
  const supabase = await createClient();
  const { data: groups } = await supabase
    .from("telegram_chats")
    .select("*")
    .order("created_at", { ascending: false });
  return (
    <section className="mt-8 rounded-xl border bg-[var(--card)]">
      <div className="border-b p-5">
        <h2 className="text-lg font-semibold">المجموعات</h2>
      </div>
      {!groups?.length ? (
        <EmptyState
          icon={Users}
          title="لا توجد مجموعات بعد"
          hint="أضف أول مجموعة. يُتحقَّق من معرّفها عبر Telegram قبل الحفظ، ثم تظهر هنا مع زر الإرسال السريع."
          action={{ href: "/dashboard/groups", label: "إضافة مجموعة" }}
        />
      ) : (
        <div className="divide-y">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center justify-between p-5">
              <div>
                <p className="text-base font-medium">{g.title}</p>
                <p className="text-sm text-[var(--muted)]">
                  {g.type} · {g.telegram_chat_id}
                </p>
              </div>
              <Link
                className="text-[15px] font-medium text-[var(--accent)] hover:underline"
                href={`/dashboard/send?chat=${encodeURIComponent(g.telegram_chat_id)}`}
              >
                إرسال
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function DashboardGroupsListFallback() {
  return (
    <div className="mt-8 rounded-xl border bg-[var(--card)]">
      <div className="border-b p-5">
        <h2 className="text-lg font-semibold">المجموعات</h2>
      </div>
      <div className="flex items-center justify-center gap-2 p-8 text-[15px] text-[var(--muted)]">
        <Spinner size={20} /> جارٍ التحميل...
      </div>
    </div>
  );
}