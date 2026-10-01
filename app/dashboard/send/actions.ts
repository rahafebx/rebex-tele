"use server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ADMIN_ERROR } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { telegram } from "@/lib/telegram/client";
import { decryptToken } from "@/lib/crypto";
import { revalidatePath } from "next/cache";

export async function sendTelegramMessage(input: {
  chatId: string;
  threadId?: number;
  html: string;
  linkPreview: boolean;
  isRich: boolean;
}) {
  if (!input.chatId || !input.html.trim())
    return { error: "اختر مجموعة واكتب رسالة." };
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  if (!rateLimit(`send:${admin.user.id}`, 30, 60_000))
    return { error: "أرسلت عددًا كبيرًا من الرسائل، حاول بعد قليل." };
  const { data: bot } = await supabase
    .from("telegram_bot")
    .select("bot_token")
    .eq("singleton", true)
    .maybeSingle();
  if (!bot?.bot_token) return { error: "اربط البوت من الإعدادات أولاً." };
  try {
    const token = decryptToken(bot.bot_token);
    if (input.isRich) {
      await telegram.sendRichMessage(token, {
        chat_id: input.chatId,
        ...(input.threadId ? { message_thread_id: input.threadId } : {}),
        rich_message: { html: input.html, is_rtl: true },
      });
    } else {
      await telegram.sendMessage(token, {
        chat_id: input.chatId,
        text: input.html,
        parse_mode: "HTML",
        ...(input.threadId ? { message_thread_id: input.threadId } : {}),
        link_preview_options: { is_disabled: !input.linkPreview },
      });
    }
    if (input.threadId) {
      const { data: existing } = await supabase
        .from("telegram_topics")
        .select("is_manually_named")
        .eq("telegram_chat_id", input.chatId)
        .eq("telegram_thread_id", input.threadId)
        .maybeSingle();
      // Clear any dismissal first. Deliberately sending into a topic is
      // stronger evidence that it exists than a tombstone left behind by a
      // remove — and without this the auto-capture would re-create the row the
      // admin dismissed, which is the same resurrection the tombstone exists to
      // prevent. Unconditional: it must happen even when the manual-name guard
      // below skips the upsert.
      await supabase
        .from("telegram_topic_dismissals")
        .delete()
        .eq("telegram_chat_id", input.chatId)
        .eq("telegram_thread_id", input.threadId);
      if (!existing?.is_manually_named) {
        await supabase.from("telegram_topics").upsert(
          {
            telegram_chat_id: input.chatId,
            telegram_thread_id: input.threadId,
          },
          { onConflict: "telegram_chat_id,telegram_thread_id" },
        );
      }
      revalidatePath("/dashboard/send");
      revalidatePath("/dashboard/groups");
    }
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "فشل طلب تيليجرام." };
  }
}
