"use client";
import { useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { login, submitMfa } from "@/app/login/actions";
import { Spinner } from "@/components/spinner";
import { Button } from "@/components/ui/button";

function SubmitButton({ pendingLabel, label }: { pendingLabel: string; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" fullWidth disabled={pending}>
      {pending && <Spinner />}
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ErrorNote({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {children}
    </div>
  );
}

// `?step=mfa` is the second half of a two-step sign-in: the password is
// already accepted (Supabase holds an aal1 session) and only the TOTP code is
// missing. The step is decided by the URL, not by local state, so a refresh
// mid-challenge doesn't drop the admin back to a password form that would
// throw the pending session away.
export function LoginForm() {
  const params = useSearchParams();
  const step = params.get("step");
  const error = params.get("error");

  if (step === "mfa") {
    return (
      <form action={submitMfa} className="space-y-4">
        <p className="text-[15px] text-[var(--muted)]">
          أدخل رمز التحقق المكوّن من 6 أرقام من تطبيق المصادقة.
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <label className="block text-[15px] font-medium">
          رمز التحقق
          <input
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            dir="ltr"
            placeholder="000000"
            className="mt-1.5 w-full rounded-lg border bg-[var(--card)] px-3 py-2.5 text-center text-base tracking-[0.4em]"
          />
        </label>
        <SubmitButton pendingLabel="جارٍ التحقق..." label="تحقق" />
        <a
          href="/login"
          className="block text-center text-[15px] text-[var(--muted)] underline"
        >
          العودة لتسجيل الدخول
        </a>
      </form>
    );
  }

  return (
    <form action={login} className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}
      <label className="block text-[15px] font-medium">
        البريد الإلكتروني
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1.5 w-full rounded-lg border bg-[var(--card)] px-3 py-2.5 text-base"
        />
      </label>
      <label className="block text-[15px] font-medium">
        كلمة المرور
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1.5 w-full rounded-lg border bg-[var(--card)] px-3 py-2.5 text-base"
        />
      </label>
      <SubmitButton pendingLabel="جارٍ تسجيل الدخول..." label="تسجيل الدخول" />
    </form>
  );
}
