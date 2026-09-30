import { createServiceClient } from "@/lib/supabase/service";
import { telegram } from "@/lib/telegram/client";
import { decryptToken } from "@/lib/crypto";
import {
  nextRunAt,
  retryDelayMs,
  MAX_CONSECUTIVE_FAILURES,
  CLAIM_WINDOW_MS,
} from "@/lib/scheduler/schedule";
import type { ScheduledMessage } from "@/lib/types";

const MAX_DUE_BATCH = 25;
const TICK_MS = 60_000;

export async function runDueScheduled() {
  const svc = createServiceClient();
  const { data: due } = await svc
    .from("scheduled_messages")
    .select("*")
    .eq("status", "active")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(MAX_DUE_BATCH);
  if (!due?.length) return { ok: true, processed: 0 };

  const { data: bot } = await svc
    .from("telegram_bot")
    .select("bot_token")
    .eq("singleton", true)
    .maybeSingle();
  if (!bot?.bot_token) return { ok: true, processed: 0 };

  let botToken: string;
  try {
    botToken = decryptToken(bot.bot_token);
  } catch (e) {
    console.error("scheduler: cannot decrypt bot token:", e);
    return { ok: true, processed: 0 };
  }

  const sentinel = new Date(Date.now() + CLAIM_WINDOW_MS).toISOString();

  let processed = 0;
  for (const item of due as ScheduledMessage[]) {
    // Optimistic claim. The UPDATE only affects the row if its next_run_at is
    // still what we just selected; a concurrent runner (cron pinger or
    // in-process ticker) that already claimed it sees 0 affected rows and
    // skips it, so each message is handed to exactly one runner.
    const { data: claimed } = await svc
      .from("scheduled_messages")
      .update({ next_run_at: sentinel })
      .eq("id", item.id)
      .eq("next_run_at", item.next_run_at)
      .select("id");
    if (!claimed?.length) continue;

    try {
      if (item.is_rich) {
        await telegram.sendRichMessage(botToken, {
          chat_id: item.telegram_chat_id,
          ...(item.telegram_thread_id
            ? { message_thread_id: item.telegram_thread_id }
            : {}),
          rich_message: { html: item.response, is_rtl: true },
        });
      } else {
        await telegram.sendMessage(botToken, {
          chat_id: item.telegram_chat_id,
          text: item.response,
          parse_mode: "HTML",
          ...(item.telegram_thread_id
            ? { message_thread_id: item.telegram_thread_id }
            : {}),
          link_preview_options: { is_disabled: !item.link_preview },
        });
      }
      processed++;
      await onSuccess(svc, item);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "فشل إرسال تيليجرام.";
      await onFailure(svc, item, message);
    }
  }
  return { ok: true, processed };
}

async function onSuccess(
  svc: Awaited<ReturnType<typeof createServiceClient>>,
  item: ScheduledMessage,
) {
  const now = new Date();
  const next =
    item.schedule_type === "once"
      ? null
      : nextRunAt(
          item.schedule_type,
          new Date(item.next_run_at),
          item.repeat_until,
          new Date(item.send_at),
        );
  const stats = {
    sent_count: item.sent_count + 1,
    consecutive_failed: 0,
    last_error: null,
    updated_at: now.toISOString(),
  };
  const patch = next
    ? { next_run_at: next.toISOString(), ...stats }
    : { status: "done", ...stats };
  const { error } = await svc
    .from("scheduled_messages")
    .update(patch)
    .eq("id", item.id);
  if (error) {
    console.error(`scheduler: failed to mark ${item.id} as sent:`, error.message);
  }
}

async function onFailure(
  svc: Awaited<ReturnType<typeof createServiceClient>>,
  item: ScheduledMessage,
  message: string,
) {
  const fail = item.consecutive_failed + 1;
  const now = new Date();
  if (fail >= MAX_CONSECUTIVE_FAILURES) {
    const { error } = await svc
      .from("scheduled_messages")
      .update({
        status: "failed",
        consecutive_failed: fail,
        last_error: message,
        updated_at: now.toISOString(),
      })
      .eq("id", item.id);
    if (error) {
      console.error(
        `scheduler: failed to mark ${item.id} as failed:`,
        error.message,
      );
    }
    return;
  }
  const { error } = await svc
    .from("scheduled_messages")
    .update({
      next_run_at: new Date(now.getTime() + retryDelayMs(fail)).toISOString(),
      consecutive_failed: fail,
      last_error: message,
      updated_at: now.toISOString(),
    })
    .eq("id", item.id);
  if (error) {
    console.error(
      `scheduler: failed to schedule retry for ${item.id}:`,
      error.message,
    );
  }
}

const g = globalThis as {
  __schedTicker__?: ReturnType<typeof setInterval>;
  __runningSched__?: boolean;
};

// Self-hosted convenience: once the first request loads this module on a
// long-running Next.js process, a per-minute loop keeps schedules firing
// without any external cron. Serverless hosts (Vercel) should use /api/cron
// instead; the per-row optimistic claim keeps both safe to run together.
export function ensureSchedulerTicker() {
  if (g.__schedTicker__) return;
  if (!process.env.REBEX_SERVICE_ROLE_KEY) return;
  g.__schedTicker__ = setInterval(async () => {
    if (g.__runningSched__) return;
    g.__runningSched__ = true;
    try {
      await runDueScheduled();
    } catch {
    } finally {
      g.__runningSched__ = false;
    }
  }, TICK_MS);
}