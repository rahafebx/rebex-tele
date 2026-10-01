"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
    <aside className="border-b bg-[var(--card)] p-4 lg:min-h-screen lg:border-b-0 lg:border-l">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <BrandMark size={32} />
          <span className="font-display text-lg">ريبيكس تيلي</span>
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
      <nav className="fixed bottom-0 left-0 right-0 z-10 bg-[var(--card)] p-5 lg:p-0 border-t lg:border-0 lg:static mt-6 flex justify-between lg:block">
        {links.map(([href, label, Icon]) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center lg:gap-2 rounded-lg px-3 py-2 text-[15px] ${pathname === href ? "bg-[var(--color-primary-50)] font-medium text-[var(--color-primary-800)] dark:bg-[var(--color-primary-900)] dark:text-[var(--color-primary-200)]" : "text-[var(--muted)] hover:bg-[var(--color-ink-25)] dark:hover:bg-[var(--color-ink-900)]"}`}
          >
            <Icon size={18} />
            <span className="hidden lg:inline-block">{label}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-6 border-t pt-4">
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
