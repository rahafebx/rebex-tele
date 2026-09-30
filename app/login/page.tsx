import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { BrandMark } from "@/components/brand-mark";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm lg:max-w-md rounded-xl border p-6">
        <div className="mb-8">
          <BrandMark size={40} radius="rounded-xl" />
          <h1 className="text-2xl font-semibold tracking-tight">
            لوحة ريبيكس تيلي
          </h1>
          <p className="mt-2 text-[15px] text-[var(--muted)]">
            سجّل الدخول لإدارة البوت الخاص بك.
          </p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
        <div className="mt-6 border-t border-[var(--border)] pt-4 text-center">
          <Link
            href="/"
            className="text-[14px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          >
            العودة للصفحة الرئيسية
          </Link>
        </div>
      </div>
    </main>
  );
}
