"use server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ADMIN_ERROR } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { telegram, type TelegramUpdate } from "@/lib/telegram/client";
import { decryptToken, decryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

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
    const rows: {
      telegram_chat_id: string;
      telegram_thread_id: number;
      name: string | null;
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
    const best = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const key = `${r.telegram_chat_id}:${r.telegram_thread_id}`;
      const cur = best.get(key);
      if (!cur || (!cur.name && r.name)) best.set(key, r);
    }
    for (const r of best.values()) {
      if (manuallyNamed.has(r.telegram_thread_id)) continue;
      const { error } = await supabase
        .from("telegram_topics")
        .upsert(r, { onConflict: "telegram_chat_id,telegram_thread_id" });
      if (error) return { error: error.message };
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
  });
}
