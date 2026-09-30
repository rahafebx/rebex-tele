"use server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ADMIN_ERROR } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { SCHED_PAGE_SIZE, SCHEDULE_DEFAULT_TITLE } from "@/lib/types";
import type { ScheduleType, ScheduledMessage } from "@/lib/types";

type ScheduleInput = {
  title?: string;
  telegramChatId: string;
  telegramThreadId?: number | null;
  scheduleType: ScheduleType;
  sendAt: string;
  repeatUntil?: string | null;
  response: string;
  editorHtml: string;
  linkPreview: boolean;
  isRich: boolean;
};

export type ScheduledListItem = ScheduledMessage & {
  chat_title: string;
  topic_name: string | null;
};

export type ScheduleListing =
  | { ok: true; items: ScheduledListItem[]; total: number; hasMore: boolean }
  | { ok: false; error: string };

export async function listScheduled(
  offset: number,
  limit: number = SCHED_PAGE_SIZE,
): Promise<ScheduleListing> {
  const supabase = await createClient();
  if (!(await requireAdmin(supabase)))
    return { ok: false, error: ADMIN_ERROR };
  const { data, count, error } = await supabase
    .from("scheduled_messages")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as ScheduledListItem[];
  const ids = [...new Set(rows.map((r) => r.telegram_chat_id))];
  const [{ data: chats }, { data: topics }] = await Promise.all([
    ids.length
      ? supabase
          .from("telegram_chats")
          .select("telegram_chat_id,title")
          .in("telegram_chat_id", ids)
      : Promise.resolve({ data: null }),
    ids.length
      ? supabase
          .from("telegram_topics")
          .select("telegram_chat_id,telegram_thread_id,name")
          .in("telegram_chat_id", ids)
      : Promise.resolve({ data: null }),
  ]);
  const chatTitle = new Map(
    (chats ?? []).map((c: { telegram_chat_id: string; title: string }) => [
      c.telegram_chat_id,
      c.title,
    ]),
  );
  const topicName = new Map(
    (topics ?? []).map(
      (
        t: {
          telegram_chat_id: string;
          telegram_thread_id: number;
          name: string | null;
        },
      ) => [`${t.telegram_chat_id}:${t.telegram_thread_id}`, t.name],
    ),
  );
  for (const row of rows) {
    row.chat_title = chatTitle.get(row.telegram_chat_id) ?? row.telegram_chat_id;
    row.topic_name = row.telegram_thread_id
      ? topicName.get(`${row.telegram_chat_id}:${row.telegram_thread_id}`) ??
        `الموضوع ${row.telegram_thread_id}`
      : null;
  }

  return {
    ok: true,
    items: rows,
    total: count ?? rows.length,
    hasMore: (count ?? rows.length) > offset + rows.length,
  };
}

function validate(input: ScheduleInput): string | null {
  if (!input.telegramChatId) return "اختر مجموعة.";
  if (!input.response.trim()) return "اكتب محتوى الرسالة أولاً.";
  const sendAt = new Date(input.sendAt);
  if (Number.isNaN(sendAt.getTime())) return "حدد وقتًا صالحًا للإرسال.";
  if (sendAt.getTime() <= Date.now())
    return "وقت الإرسال يجب أن يكون في المستقبل.";
  if (input.scheduleType === "once" || !input.scheduleType)
    return null;
  if (input.repeatUntil) {
    const until = new Date(input.repeatUntil);
    if (Number.isNaN(until.getTime())) return "حدد وقت انتهاء صالحًا.";
    if (until.getTime() <= sendAt.getTime())
      return "وقت الانتهاء يجب أن يكون بعد وقت بدء الإرسال.";
  }
  return null;
}

export async function createScheduled(input: ScheduleInput) {
  const message = validate(input);
  if (message) return { error: message };
  const supabase = await createClient();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const { error } = await supabase.from("scheduled_messages").insert({
    title: input.title?.trim() || SCHEDULE_DEFAULT_TITLE,
    telegram_chat_id: input.telegramChatId,
    telegram_thread_id: input.telegramThreadId ?? null,
    schedule_type: input.scheduleType,
    send_at: input.sendAt,
    repeat_until: input.repeatUntil ?? null,
    response: input.response.trim(),
    editor_html: input.editorHtml,
    link_preview: input.linkPreview,
    is_rich: input.isRich,
    next_run_at: input.sendAt,
    status: "active",
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/schedule");
  return { ok: true };
}

export async function updateScheduled(id: string, input: ScheduleInput) {
  const message = validate(input);
  if (message) return { error: message };
  const supabase = await createClient();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const { data: existing } = await supabase
    .from("scheduled_messages")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { error: "الجدولة غير موجودة." };
  const patch = {
    title: input.title?.trim() || SCHEDULE_DEFAULT_TITLE,
    telegram_chat_id: input.telegramChatId,
    telegram_thread_id: input.telegramThreadId ?? null,
    schedule_type: input.scheduleType,
    send_at: input.sendAt,
    repeat_until: input.repeatUntil ?? null,
    response: input.response.trim(),
    editor_html: input.editorHtml,
    link_preview: input.linkPreview,
    is_rich: input.isRich,
    next_run_at: input.sendAt,
    consecutive_failed: 0,
    last_error: null,
    status:
      existing.status === "done" || existing.status === "failed"
        ? ("active" as const)
        : existing.status,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("scheduled_messages")
    .update(patch)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/schedule");
  return { ok: true };
}

export async function deleteScheduled(id: string) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  const { error } = await supabase
    .from("scheduled_messages")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  await logAudit(
    "admin.schedule.deleted",
    {},
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard/schedule");
  return { ok: true };
}

export async function toggleScheduled(id: string) {
  const supabase = await createClient();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const { data: existing } = await supabase
    .from("scheduled_messages")
    .select("status, next_run_at, send_at")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { error: "الجدولة غير موجودة." };
  let patch: Record<string, unknown> | null = null;
  if (existing.status === "active") {
    patch = { status: "paused", updated_at: new Date().toISOString() };
  } else if (existing.status === "paused") {
    const next = new Date(existing.next_run_at);
    const fallback = new Date(existing.send_at);
    const base = next.getTime() > Date.now() ? next : fallback;
    patch = {
      status: "active",
      next_run_at:
        base.getTime() > Date.now()
          ? base.toISOString()
          : new Date().toISOString(),
      consecutive_failed: 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    };
  } else {
    return { error: "لا يمكن تغيير حالة هذه الجدولة." };
  }
  const { error } = await supabase
    .from("scheduled_messages")
    .update(patch)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/schedule");
  return { ok: true, status: String(patch.status) };
}