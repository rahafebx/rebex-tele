"use client";
import { Code, Eye } from "lucide-react";
import { Button } from "./ui/button";

export type EditView = "preview" | "source";

export function EditViewToggle({
  view,
  onChange,
}: {
  view: EditView;
  onChange: (view: EditView) => void;
}) {
  // Segmented control. The two options sit inside a container that supplies the
  // border and the p-0.5 inset, so these override the variant's own padding
  // rather than nesting a second border.
  const seg = "gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium";
  return (
    <div className="inline-flex items-center rounded-lg border bg-[var(--color-ink-50)] p-0.5 dark:bg-[var(--color-ink-800)]">
      <Button
        variant="ghost"
        title="عرض التنسيق"
        size="sm"
        onClick={() => onChange("preview")}
        aria-pressed={view === "preview"}
        active={view === "preview"}
        className={seg}
      >
        <Eye size={15} /> معاينة
      </Button>
      <Button
        variant="ghost"
        title="عرض كود المصدر"
        size="sm"
        onClick={() => onChange("source")}
        aria-pressed={view === "source"}
        active={view === "source"}
        className={seg}
      >
        <Code size={15} /> المصدر
      </Button>
    </div>
  );
}