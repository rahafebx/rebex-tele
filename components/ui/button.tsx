import { forwardRef } from "react";

/**
 * The button primitive. Every `<button>` in the app now goes through this,
 * because the same 15-token class string had been copy-pasted 50 times and had
 * already drifted into six near-identical variants of itself.
 *
 * Three axes, each matching a distinction the markup was already making by
 * hand rather than one invented up front:
 *
 *   variant   how loud the action is — the one real decision per button
 *   size      how much room it takes, so a row of actions lines up
 *   active    toggle state, for the view/format switchers
 *
 * Deliberately no `cva`/`clsx`: this project has neither, and a lookup map is
 * the whole of what a variant system needs at this size.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const VARIANTS: Record<Variant, string> = {
  // The single committing action in a group. One per view.
  primary:
    "bg-[var(--accent)] font-medium text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)]",

  // Everything else that is still a real action: cancel, save, edit, connect.
  // Muted text on a border keeps it quieter than primary without reading as
  // disabled, which is why this is not `text-[var(--foreground)]`.
  secondary: "border text-[var(--muted)] hover:text-[var(--foreground)]",

  // No border. For dense toolbars and the one-off row actions (sign out, the
  // editor's format buttons) where a border would crowd the neighbours.
  ghost:
    "text-[var(--muted)] hover:bg-[var(--color-ink-50)] hover:text-[var(--foreground)] dark:hover:bg-[var(--color-ink-800)]",

  // Destructive and final: confirming a delete, stopping a schedule. Uses
  // --danger-solid, not --danger -- see the note in globals.css. --danger is
  // the *foreground* token, and its dark value (#f87171) is only 2.77:1 on
  // white, so reusing it as a fill failed AA in dark mode.
  danger: "bg-[var(--danger-solid)] font-medium text-white hover:bg-[var(--danger-solid-hover)]",
};

/**
 * Every tone in one place. Each entry is *colour only* — padding and type size
 * come from `size`, so a tone can be reused at any size.
 *
 * The four that aren't variants are separate entries rather than a variant plus
 * a `className` override, because Tailwind resolves two conflicting utilities
 * by stylesheet source order, not by className order. Concretely:
 * `.hover\:text-\[var\(--danger\)\]` is emitted *before*
 * `.hover\:text-\[var\(--foreground\)\]`, so layering a danger hover on top of
 * `ghost` silently loses and the button stays muted. Same trap as the `radius`
 * prop on BrandMark.
 */
const TONES = {
  ...VARIANTS,

  /**
   * Toggle-on treatment: inverted, so the selected option reads as "on" in both
   * themes without leaning on colour alone (it also carries `aria-pressed`).
   */
  active:
    "bg-[var(--foreground)] text-[var(--background)] hover:bg-[var(--foreground)]",

  /**
   * Destructive, but still only a trigger -- the bordered "delete" / "disconnect"
   * that reveals a confirm button, rather than the confirm itself.
   */
  dangerOutline:
    "border text-[var(--muted)] hover:text-[var(--danger)]",

  /** Unbordered danger, for an icon-only delete in a list row. */
  dangerGhost:
    "text-[var(--muted)] hover:bg-[var(--color-ink-50)] hover:text-[var(--danger)] dark:hover:bg-[var(--color-ink-800)]",

  /**
   * Accent-coloured text rather than a filled button, for the two navigational
   * actions on the Groups page (manage topics, refresh from Telegram). They sit
   * on a tinted row where a filled primary would compete with the row's own
   * actions, and neither of them commits anything.
   */
  accentOutline:
    "border font-medium text-[var(--color-primary-700)] hover:bg-[var(--color-primary-50)] dark:text-[var(--color-primary-300)] dark:hover:bg-[var(--color-primary-900)]",

  /** The same accent treatment with no border, at toolbar size. */
  accentGhost:
    "font-medium text-[var(--color-primary-700)] hover:bg-[var(--color-primary-50)] dark:text-[var(--color-primary-300)] dark:hover:bg-[var(--color-primary-900)]",
} as const;

/** Explicit tones win over `variant`, and `active` wins over everything. */
function resolveTone(opts: {
  variant: Variant;
  dangerOutline: boolean;
  dangerGhost: boolean;
  accentOutline: boolean;
  accentGhost: boolean;
  active: boolean;
}): string {
  const { active, ...rest } = opts;
  for (const flag of [
    "dangerGhost",
    "dangerOutline",
    "accentOutline",
    "accentGhost",
  ] as const) {
    if (rest[flag]) return TONES[flag];
  }
  return active ? TONES.active : VARIANTS[opts.variant];
}

const SIZES: Record<Size, string> = {
  sm: "gap-1.5 px-3 py-1.5 text-sm",
  md: "gap-2 px-4 py-2.5 text-[15px]",
  // Square hit target for an icon with no label. 36px, comfortably clear of
  // the 24px minimum once the focus ring is drawn around it.
  icon: "size-9 justify-center",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Bordered danger, for a destructive action that is itself the trigger. */
  dangerOutline?: boolean;
  /** Unbordered danger, for an icon-only delete in a list row. */
  dangerGhost?: boolean;
  /** Bordered accent text, for a navigational action that is not the commit. */
  accentOutline?: boolean;
  /** Unbordered accent text at toolbar size. */
  accentGhost?: boolean;
  /** Toggle state. Pair with `aria-pressed` for anything a screen reader reads. */
  active?: boolean;
  /** Stretch to the container. The login and webhook buttons are full-width. */
  fullWidth?: boolean;
}

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      dangerOutline = false,
      dangerGhost = false,
      accentOutline = false,
      accentGhost = false,
      active = false,
      fullWidth = false,
      className,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const tone = resolveTone({
      variant,
      dangerOutline,
      dangerGhost,
      accentOutline,
      accentGhost,
      active,
    });

    return (
      <button
        ref={ref}
        // Defaulting to "button" matters: a bare <button> inside a <form>
        // submits, and several of these sit in forms where that would be a
        // silent data-loss bug.
        type={type}
        className={cx(
          "inline-flex items-center rounded-lg transition-colors disabled:opacity-50",
          SIZES[size],
          tone,
          fullWidth && "w-full justify-center",
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
export default Button;
