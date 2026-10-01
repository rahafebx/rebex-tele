"use client";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-10 place-items-center rounded-xl bg-[var(--accent)] text-xl font-bold text-[var(--accent-foreground)]">
          ت
        </div>
        <h1 className="text-xl font-semibold">حدث خطأ ما</h1>
        <p className="mt-2 text-[15px] text-[var(--muted)]">
          {error.message || "حدث خطأ غير متوقع."}
        </p>
        <Button variant="primary" size="md" className="mt-6" onClick={() => reset()}>
          إعادة المحاولة
        </Button>
      </div>
    </main>
  );
}
