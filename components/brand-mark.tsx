import { Hash } from "lucide-react";

// The product mark: a hash in the accent square, shared by the landing page,
// the dashboard sidebar, the login form and the 404 page. `size` is the square's
// edge in px; the glyph is scaled to keep the same optical weight at every size.
//
// `radius` is an explicit prop rather than something callers pass through
// className: overriding `rounded-lg` with `rounded-xl` in a className does NOT
// work, because two conflicting Tailwind utilities are resolved by CSS source
// order and not by their order in the attribute.
export function BrandMark({
  size = 32,
  radius = "rounded-lg",
  className,
}: {
  size?: number;
  radius?: "rounded-lg" | "rounded-xl";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center ${radius} bg-[var(--accent)] text-[var(--accent-foreground)] ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <Hash style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-semibold ${className ?? ""}`}>
      <BrandMark />
      <span className="font-display text-lg">ريبيكس تيلي</span>
    </span>
  );
}
