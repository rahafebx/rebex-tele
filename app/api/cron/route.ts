import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDueScheduled, ensureSchedulerTicker } from "@/lib/scheduler/run";
import { rateLimit } from "@/lib/rate-limit";

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  // Rate-limit attempts per IP before even checking the secret, so an
  // attacker can't brute-force x-cron-secret faster than 10 tries/min.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`cron:${ip}`, 10, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const secret = process.env.TELEX_CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "cron secret not configured" },
      { status: 503 },
    );
  const header = request.headers.get("x-cron-secret");
  if (!header || !safeEqual(header, secret))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // On self-hosted next start this (re)starts the per-minute ticker in the
  // same process; on serverless hosts the cron ping itself triggers the run.
  ensureSchedulerTicker();
  const result = await runDueScheduled();
  return NextResponse.json(result);
}