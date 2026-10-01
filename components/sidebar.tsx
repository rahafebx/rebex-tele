"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Send,
  Settings,
  Users,
  Command,
  FileText,
  CalendarClock,
  Shield,
  LogOut,
  Sun,
  Moon,
  User,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/dashboard/actions";

const links = [
  ["/dashboard", "لوحة التحكم", LayoutDashboard],
  ["/dashboard/groups", "المجموعات", Users],
  ["/dashboard/commands", "الأوامر", Command],
  ["/dashboard/send", "إرسال رسالة", Send],
  ["/dashboard/schedule", "جدولة الرسائل", CalendarClock],
  ["/dashboard/templates", "القوالب", FileText],
  ["/dashboard/settings", "الإعدادات", Settings],
  ["/dashboard/security", "الأمان", Shield],
] as const;

export function Sidebar({
  email,
  lastLogin,
}: {
  email: string;
  lastLogin: string;
}) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  return (
    // Two unrelated problems share this element.
    //
    // Large screens: this is a grid item, and a grid item stretches to the full
    // row height by default — which left the sidebar with no room to move, so it
    // scrolled away with the content. `lg:self-start` opts out of the stretch.
    // The rest (sticky/h-screen/overflow-y-auto) keeps the column pinned to the
    // viewport and scrolling internally when the nav is taller than the window.
    //
    // Small and md: the header has to be a fixed bar so it stays put while the
    // page scrolls under it, which means it leaves the flow and `main` needs
    // matching top padding (`pt-20 sm:pt-24` in the dashboard layout). Hence no
    // `p-4` on this element until `lg:`, where it is a real column again.
    <aside className="bg-[var(--card)] lg:sticky lg:top-0 lg:self-start lg:h-screen lg:overflow-y-auto lg:border-l lg:p-4">
      {/* `fixed`, not `sticky`: the sticky containing block would be this
          <aside>, which on small screens is only as tall as the bar itself —
          there is no room to travel, so it would scroll away like a normal
          block. Fixed takes it out of the flow entirely, and the spacer below
          reserves its height. `lg:static` hands it back to the column. */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-2 border-b border-[var(--card-border)] bg-[var(--card)]/85 px-4 py-3 backdrop-blur lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <div className="flex items-center gap-2 font-semibold">
          <BrandMark size={32} />
          <span className="font-display text-lg">ريبيكس تيلي</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="lg:hidden">
            <UserMenu email={email} lastLogin={lastLogin} />
          </div>
          <Button
            variant="ghost"
            className="p-2"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="تبديل السمة"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </div>
      </div>
      {/* Reserves the header's height so content is not permanently hidden behind
          the fixed bar. 61px = py-3 top and bottom + a 36px control + a 1px
          border. Must be changed together with the header's padding. */}
      <div aria-hidden="true" className="h-[61px] lg:hidden" />
      {/* `flex justify-between` is what spreads the 8 icon-only links across the
          bar — it is not decorative, and without it the block nav stacks
          vertically and runs off the screen. */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex justify-between border-t border-[var(--card-border)] bg-[var(--card)]/95 p-2 backdrop-blur lg:static lg:z-auto lg:mt-6 lg:block lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        {links.map(([href, label, Icon]) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-[15px] lg:px-3 lg:py-2 ${pathname === href ? "bg-[var(--color-primary-50)] font-medium text-[var(--color-primary-800)] dark:bg-[var(--color-primary-900)] dark:text-[var(--color-primary-200)]" : "text-[var(--muted)] hover:bg-[var(--color-ink-25)] dark:hover:bg-[var(--color-ink-900)]"}`}
          >
            <Icon size={18} />
            <span className="hidden lg:inline-block">{label}</span>
          </Link>
        ))}
      </nav>
      {/* Below lg the account lives in the header's popover instead. */}
      <div className="mt-6 hidden border-t border-[var(--card-border)] pt-4 lg:block">
        <p className="truncate text-sm text-[var(--muted)]">
          {email}
        </p>
        {lastLogin && (
          <p className="mt-1 flex flex-col gap-2 truncate text-xs text-[var(--muted)]">
            <span>آخر تسجيل دخول:</span>
            <span>{lastLogin}</span>
          </p>
        )}
        <Button
          variant="ghost"
          className="mt-3 px-0 text-[15px]"
          onClick={signOut}
        >
          <LogOut size={17} /> تسجيل الخروج
        </Button>
      </div>
    </aside>
  );
}

/**
 * The account block as a popover, for screens too narrow to give it a column.
 *
 * Rendered only below `lg`; from `lg:` the same information stays inline at the
 * foot of the sidebar. The panel is `absolute` rather than `fixed` on purpose —
 * it is positioned against its own `relative` wrapper, which means it is not
 * affected by the header bar being out of flow, and it cannot drift if the
 * header's height ever changes.
 *
 * A disclosure, not a `role="menu"`: there is one action, so a menu would claim
 * arrow-key navigation it does not implement. Tab reaches the panel, Escape
 * closes it and returns focus to the trigger.
 */
function UserMenu({
  email,
  lastLogin,
}: {
  email: string;
  lastLogin: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click and on Escape, and return focus to the trigger on
  // Escape so keyboard focus is never left on a node that no longer exists.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="حساب المستخدم"
        className="flex size-9 items-center justify-center rounded-full border border-[var(--card-border)] text-[var(--muted)] transition-colors hover:bg-[var(--color-ink-50)] hover:text-[var(--foreground)] dark:hover:bg-[var(--color-ink-800)]"
      >
        <User size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="حساب المستخدم"
          className="absolute end-0 top-full z-50 mt-2 w-60 rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-lg"
        >
          <p className="truncate text-sm font-medium">{email}</p>
          {lastLogin && (
            <p className="mt-2 flex flex-col gap-1 text-xs text-[var(--muted)]">
              <span>آخر تسجيل دخول:</span>
              <span>{lastLogin}</span>
            </p>
          )}
          {/* No `fullWidth`: it emits `w-full justify-center`, and Tailwind resolves
              the resulting `justify-start`/`justify-center` clash by stylesheet
              source order rather than className order. Spelling out the width
              here keeps the alignment from depending on that. The button's own
              `px-4` (from size md) then matches the popover's `p-4`, so the
              label lines up with the email above it. */}
            <Button
              variant="ghost"
              className="mt-3 w-full justify-start"
              onClick={signOut}
            >
              <LogOut size={17} /> تسجيل الخروج
            </Button>
        </div>
      )}
    </div>
  );
}
