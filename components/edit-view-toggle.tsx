"use client";
import { Code, Eye } from "lucide-react";

export type EditView = "preview" | "source";

export function EditViewToggle({
  view,
  onChange,
}: {
  view: EditView;
  onChange: (view: EditView) => void;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors";
  const active = "bg-[var(--foreground)] text-[var(--background)]";
  const idle = "text-[var(--muted)] hover:text-[var(--foreground)]";
  return (
    <div className="inline-flex items-center rounded-lg border bg-[var(--color-ink-50)] p-0.5 dark:bg-[var(--color-ink-800)]">
      <button
        type="button"
        title="عرض التنسيق"
        onClick={() => onChange("preview")}
        aria-pressed={view === "preview"}
        className={`${base} ${view === "preview" ? active : idle}`}
      >
        <Eye size={15} /> معاينة
      </button>
      <button
        type="button"
        title="عرض كود المصدر"
        onClick={() => onChange("source")}
        aria-pressed={view === "source"}
        className={`${base} ${view === "source" ? active : idle}`}
      >
        <Code size={15} /> المصدر
      </button>
    </div>
  );
}