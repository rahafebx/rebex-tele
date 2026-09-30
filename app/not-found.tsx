import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 w-fit">
          <BrandMark size={40} radius="rounded-xl" />
        </div>
        <h1 className="text-xl font-semibold">الصفحة غير موجودة</h1>
        <p className="mt-2 text-[15px] text-[var(--muted)]">
          الصفحة التي طلبتها غير موجودة.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
        >
          العودة للصفحة الرئيسية
        </Link>
      </div>
    </main>
  );
}
