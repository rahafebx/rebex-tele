import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * The empty state every list in the dashboard shows before it has rows.
 *
 * Deliberately renders **no card chrome of its own** — icon, title, hint, and
 * an optional action. Every call site already sits inside a bordered `section`
 * with its own header, so a self-bordered variant would nest a border inside a
 * border. The visual language (accent-tinted icon square, muted hint, accent
 * button) is lifted from the landing page's feature cards so the two halves of
 * the product match.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-lg bg-[var(--color-primary-50)] text-[var(--color-primary-700)] dark:bg-[var(--color-primary-900)] dark:text-[var(--color-primary-200)]">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="mt-4 text-[17px] font-medium">{title}</p>
      {hint && (
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
          {hint}
        </p>
      )}
      {action && (
        <Link
          href={action.href}
          className="mt-5 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
