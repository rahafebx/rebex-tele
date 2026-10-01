"use server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ADMIN_ERROR } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { telegram, type TelegramUpdate } from "@/lib/telegram/client";
import { decryptToken, decryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Tolerance for `dismissed_at` (this server's clock) against an update's
 * `message.date` (Telegram's). A dismissal only hides a topic when the newest
 * update describing it is this far *older* than the dismissal, so a server
 * clock running slightly ahead cannot hide a message that genuinely arrived
 * afterwards — which would look exactly like a mis-dismissal that failed to
 * heal.
 */
const DISMISSAL_SKEW_MS = 5 * 60_000;

export async function addGroup(formData: FormData) {
  const chatId = String(formData.get("chatId") ?? "").trim();
  if (!chatId) return { error: "أدخل معرّف محادثة تيليجرام." };
  const supabase = await createClient();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const { data: bot } = await supabase
    .from("telegram_bot")
    .select("bot_token")
    .maybeSingle();
  if (!bot?.bot_token) return { error: "اربط البوت من الإعدادات أولاً." };
  try {
    const chat = await telegram.getChat(decryptToken(bot.bot_token), chatId);
    const { error } = await supabase.from("telegram_chats").upsert(
      {
        telegram_chat_id: String(chat.id),
        title: chat.title ?? chat.username ?? String(chat.id),
        username: chat.username ?? null,
        type: chat.type,
        is_forum: chat.is_forum ?? false,
      },
      { onConflict: "telegram_chat_id" },
    );
    if (error) return { error: error.message };
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/groups");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "فشل طلب تيليجرام." };
  }
}

export async function removeGroup(id: string) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  const { error } = await supabase.from("telegram_chats").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(
    "admin.group.deleted",
    {},
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/groups");
  return { ok: true };
}

export async function refreshChatTopics(chatId: string) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  if (!rateLimit(`refresh:${admin.user.id}`, 10, 60_000))
    return { error: "تحديث كثير جدًا، حاول بعد قليل." };
  const { data: bot, error: botError } = await supabase
    .from("telegram_bot")
    .select(
      "bot_token, bot_username, watch_bot_token, watch_bot_username, webhook_secret",
    )
    .maybeSingle();
  if (botError)
    return {
      error:
        "تعذّرت قراءة إعدادات البوت. تأكد من تطبيق ملف الترحيل 012 (أعمدة بوت المراقبة) في محرر SQL.",
    };
  if (!bot?.bot_token) return { error: "اربط البوت من الإعدادات أولاً." };
  let botToken: string;
  let watchToken: string | null | undefined;
  try {
    botToken = decryptToken(bot.bot_token);
    watchToken = decryptSecret(bot.watch_bot_token);
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "تعذّر فك تشفير رمز البوت.",
    };
  }
  const hasWatch = Boolean(watchToken && watchToken !== botToken);
  if (!hasWatch && bot.webhook_secret)
    return {
      error:
        "تعذّر تحديث المواضيع: الويب هوك (الأوامر) يمنع الاستطلاع. اربط بوت مراقبة للمواضيع من صفحة الإعدادات ليعملا معًا.",
    };
  const scanToken = hasWatch ? watchToken! : botToken;
  try {
    if (hasWatch) {
      const info = await telegram.getWebhookInfo(scanToken);
      if (info.url)
        return {
          error:
            "بوت المراقبة عليه ويب هوك مسجّل، فلا يمكن استطلاع المواضيع به (تعارض 409). افصل الويب هوك من هذا البوت أو استخدم بوتًا جديدًا — لا تربط بوت المراقبة من صفحة الأوامر أبدًا.",
        };
    }
    const { data: existing } = await supabase
      .from("telegram_topics")
      .select("telegram_thread_id")
      .eq("telegram_chat_id", chatId)
      .eq("is_manually_named", true);
    const manuallyNamed = new Set(
      (existing ?? []).map((r) => r.telegram_thread_id),
    );
    // Dismissals the admin has recorded for this chat. Read separately from the
    // topics above precisely because it has to live in its own table: an RLS
    // predicate hiding dismissed rows would hide these from this very function.
    //
    // Unlike the `manuallyNamed` read, a failure here is returned rather than
    // ignored — silently reading zero dismissals is exactly the resurrection
    // this fixes.
    const { data: dismissals, error: dismissalsError } = await supabase
      .from("telegram_topic_dismissals")
      .select("telegram_thread_id, name, dismissed_at")
      .eq("telegram_chat_id", chatId);
    if (dismissalsError)
      return {
        // 42P01 is Postgres' undefined_table. Distinguishing it matters: telling
        // the admin to apply a migration they already applied sends them down
        // the wrong path for what may be a permissions problem.
        error:
          dismissalsError.code === "42P01"
            ? "تعذّرت قراءة المواضيع المحذوفة. تأكد من تطبيق ملف الترحيل 07 في محرر SQL."
            : "تعذّرت قراءة المواضيع المحذوفة.",
      };
    const dismissed = new Map(
      (dismissals ?? []).map((r) => [
        r.telegram_thread_id as number,
        {
          at: new Date(r.dismissed_at as string).getTime(),
          name: (r.name ?? null) as string | null,
        },
      ]),
    );
    const rows: {
      telegram_chat_id: string;
      telegram_thread_id: number;
      name: string | null;
      date: number;
    }[] = [];
    let offset = 0;
    for (let i = 0; i < 20; i++) {
      const updates = await telegram.getUpdates(scanToken, {
        offset,
        limit: 100,
        timeout: 0,
        allowed_updates: [
          "message",
          "forum_topic_created",
          "forum_topic_edited",
        ],
      });
      if (!updates.length) break;
      for (const u of updates) {
        offset = Math.max(offset, u.update_id + 1);
        collectTopics(u, chatId, rows);
      }
      if (updates.length < 100) break;
    }
    const best = new Map<
      string,
      { name: string | null; date: number; threadId: number }
    >();
    for (const r of rows) {
      const key = `${r.telegram_chat_id}:${r.telegram_thread_id}`;
      const cur = best.get(key);
      if (!cur) {
        best.set(key, {
          name: r.name,
          date: r.date,
          threadId: r.telegram_thread_id,
        });
        continue;
      }
      // Prefer whichever update knew a name; separately keep the NEWEST date,
      // because that is what decides whether Telegram is describing the topic
      // after the admin dismissed it. A topic with only old messages must still
      // count as dismissed.
      if (!cur.name && r.name) cur.name = r.name;
      if (r.date > cur.date) cur.date = r.date;
    }
    for (const r of best.values()) {
      if (manuallyNamed.has(r.threadId)) continue;
      const dismissedAt = dismissed.get(r.threadId);
      // A dismissal means "ignore what Telegram knew before this moment", not
      // "this thread id is banned". If Telegram describes the topic *after* the
      // dismissal — i.e. it is still alive and someone posted in it — the
      // topic was dismissed by mistake and comes back.
      if (dismissedAt && dismissedAt.at - DISMISSAL_SKEW_MS > r.date) continue;
      // Only reached on the revive path or for a topic never dismissed. The
      // remembered name keeps a self-healed topic from coming back as a bare
      // thread id, since an ordinary message carries no name.
      const name = r.name ?? dismissedAt?.name ?? null;
      const { error } = await supabase
        .from("telegram_topics")
        .upsert(
          { telegram_chat_id: chatId, telegram_thread_id: r.threadId, name },
          { onConflict: "telegram_chat_id,telegram_thread_id" },
        );
      if (error) return { error: error.message };
      // The dismissal has served its purpose — clear it so the row's own
      // lifecycle takes over and the tombstone pile does not grow.
      if (dismissedAt)
        await supabase
          .from("telegram_topic_dismissals")
          .delete()
          .eq("telegram_chat_id", chatId)
          .eq("telegram_thread_id", r.threadId);
    }
    const chat = await telegram.getChat(botToken, chatId);
    await supabase
      .from("telegram_chats")
      .update({ is_forum: chat.is_forum ?? false })
      .eq("telegram_chat_id", chatId);
    const { data: list } = await supabase
      .from("telegram_topics")
      .select("*")
      .eq("telegram_chat_id", chatId)
      .order("name", { ascending: true, nullsFirst: true });
    revalidatePath("/dashboard/send");
    revalidatePath("/dashboard/groups");
    return {
      ok: true,
      topics: list ?? [],
      scannedWith: hasWatch
        ? (bot.watch_bot_username ?? "بوت المراقبة")
        : (bot.bot_username ?? "البوت الرئيسي"),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/conflict/i.test(msg) && /webhook/i.test(msg))
      return {
        error:
          "تعذّر استطلاع المواضيع: تعارض مع الويب هوك (409). تأكد أن بوت المراقبة بوت مختلف عن البوت الرئيسي وليس عليه ويب هوك.",
      };
    return { error: msg || "فشل طلب تيليجرام." };
  }
}

export async function removeTopic(id: string) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  // The delete is by row id, so the tombstone needs the thread id first.
  const { data: topic, error: readError } = await supabase
    .from("telegram_topics")
    .select("telegram_chat_id, telegram_thread_id, name")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!topic) return { error: "الموضوع غير موجود." };
  // Dismissal BEFORE the delete, deliberately. If the delete then fails the
  // admin is left with a still-visible topic plus a tombstone — recoverable,
  // and renameTopic still works. The other order leaves no trace and the next
  // refresh silently brings the topic back.
  const { error: dismissError } = await supabase
    .from("telegram_topic_dismissals")
    .upsert(
      {
        telegram_chat_id: topic.telegram_chat_id,
        telegram_thread_id: topic.telegram_thread_id,
        name: topic.name,
      },
      // ignoreDuplicates, not a plain upsert: dismissing the same topic twice
      // must be idempotent. A DO UPDATE would push dismissed_at forward and
      // extend the window in which the topic stays hidden.
      {
        onConflict: "telegram_chat_id,telegram_thread_id",
        ignoreDuplicates: true,
      },
    );
  if (dismissError) return { error: dismissError.message };
  const { error } = await supabase
    .from("telegram_topics")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  await logAudit(
    "admin.topic.deleted",
    {},
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard/send");
  revalidatePath("/dashboard/groups");
  return { ok: true };
}

export async function renameTopic(id: string, name: string) {
  const supabase = await createClient();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const trimmed = name.trim();
  if (!trimmed) return { error: "أدخل اسمًا للموضوع." };
  const { error } = await supabase
    .from("telegram_topics")
    .update({ name: trimmed, is_manually_named: true })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/send");
  revalidatePath("/dashboard/groups");
  return { ok: true };
}

function collectTopics(
  u: TelegramUpdate,
  chatId: string,
  rows: {
    telegram_chat_id: string;
    telegram_thread_id: number;
    name: string | null;
    date: number;
  }[],
) {
  const m = u.message;
  if (!m || !m.message_thread_id || m.message_thread_id < 1) return;
  if (String(m.chat?.id ?? "") !== chatId) return;
  const event = m.forum_topic_created ?? m.forum_topic_edited;
  rows.push({
    telegram_chat_id: chatId,
    telegram_thread_id: m.message_thread_id,
    name: event?.name ?? null,
    // 0 rather than `Date.now()`: an update carrying no date is no evidence
    // that it postdates a dismissal, so it has to count as pre-dismissal.
    date: (m.date ?? 0) * 1000,
  });
}
