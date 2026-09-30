import type { ScheduleType } from "@/lib/types";

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function clampDay(year: number, month: number, day: number) {
  return Math.min(day, daysInMonth(year, month));
}

function build(from: Date, y: number, m: number, d: number) {
  return new Date(
    y,
    m,
    d,
    from.getHours(),
    from.getMinutes(),
    from.getSeconds(),
    from.getMilliseconds(),
  );
}

// Returns the run time after `from`, or null when the chain must stop
// (a one-time message, or repeat_until has been reached/passed).
// Months/years advance from the previous slot, but the day-of-month is
// anchored to the original `send_at` (e.g. a Jan 31 monthly send fires
// Feb 28, then Mar 31, then Apr 30...).
export function nextRunAt(
  type: ScheduleType,
  from: Date,
  repeatUntil: string | null,
  anchor: Date,
): Date | null {
  let next: Date;
  switch (type) {
    case "once":
      return null;
    case "daily":
      next = new Date(from.getTime() + 24 * 60 * 60 * 1000);
      break;
    case "weekly":
      next = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case "monthly": {
      const y = from.getMonth() === 11 ? from.getFullYear() + 1 : from.getFullYear();
      const m = from.getMonth() === 11 ? 0 : from.getMonth() + 1;
      next = build(from, y, m, clampDay(y, m, anchor.getDate()));
      break;
    }
    case "yearly": {
      const y = from.getFullYear() + 1;
      next = build(
        from,
        y,
        anchor.getMonth(),
        clampDay(y, anchor.getMonth(), anchor.getDate()),
      );
      break;
    }
  }
  if (repeatUntil && next.getTime() > new Date(repeatUntil).getTime()) return null;
  return next;
}

// Backoff between retries: 5s are doubled per consecutive failure
// (5m, 10m, 20m, 40m...). On the 5th consecutive failure the runner
// stops the schedule instead of retrying.
export const MAX_CONSECUTIVE_FAILURES = 5;

// While a message's send is in flight the runner parks its next_run_at this far
// into the future so no concurrent runner can pick it up again. A crash between
// claim and finalize then self-heals: the row becomes due again after this
// window instead of being stuck forever.
//
// Lives here rather than in run.ts because the dashboard's "overdue" card needs
// the same number, and this module is the dependency-free one — importing run.ts
// into a page would drag the Telegram client and the service-role client along.
export const CLAIM_WINDOW_MS = 5 * 60_000;

export function retryDelayMs(consecutiveFailed: number) {
  // consecutiveFailed already incremented for this try (1..4 here).
  return Math.min(2 ** (consecutiveFailed - 1), 8) * 5 * 60_000;
}