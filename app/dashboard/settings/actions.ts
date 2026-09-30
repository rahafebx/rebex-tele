"use server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ADMIN_ERROR } from "@/lib/supabase/admin";
import { telegram } from "@/lib/telegram/client";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function connectBot(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "أدخل رمز البوت." };
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  try {
    const me = await telegram.getMe(token);
    const { data: existing } = await supabase
      .from("telegram_bot")
      .select("watch_bot_token")
      .maybeSingle();
    if (decryptSecret(existing?.watch_bot_token) === token)
      return {
        error:
          "البوت الرئيسي لا يمكن أن يكون نفسه بوت المراقبة. أنشئ بوتًا منفصلًا لكل دور.",
      };
    const { error } = await supabase
      .from("telegram_bot")
      .upsert(
        {
          singleton: true,
          bot_token: encryptSecret(token),
          bot_id: me.id,
          bot_username: me.username ?? null,
        },
        { onConflict: "singleton" },
      );
    if (error) return { error: error.message };
    await logAudit(
      "settings.bot.connected",
      { username: me.username ?? null },
      { source: await headers(), actorId: admin.user.id },
    );
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/settings");
    return { ok: true, username: me.username ?? me.first_name };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "رمز بوت غير صحيح." };
  }
}

export async function connectWatchBot(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "أدخل رمز بوت المراقبة." };
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  try {
    const me = await telegram.getMe(token);
    const info = await telegram.getWebhookInfo(token);
    if (info.url)
      return {
        error:
          "بوت المراقبة هذا عليه ويب هوك مسجّل بالفعل، فلا يمكن استطلاع المواضيع به (تعارض 409). افصل الويب هوك منه أو استخدم بوتًا جديدًا.",
      };
    const { data: existing } = await supabase
      .from("telegram_bot")
      .select("id, bot_token")
      .maybeSingle();
    if (decryptSecret(existing?.bot_token) === token)
      return {
        error: "البوت المراقب لا يمكن أن يكون نفسه البوت الرئيسي. أنشئ بوتًا ثانيًا من BotFather.",
      };
    const fields = {
      watch_bot_token: encryptSecret(token),
      watch_bot_id: me.id,
      watch_bot_username: me.username ?? null,
    };
    const { error } = existing
      ? await supabase.from("telegram_bot").update(fields).eq("id", existing.id)
      : await supabase
          .from("telegram_bot")
          .insert({ singleton: true, ...fields });
    if (error) return { error: error.message };
    await logAudit(
      "settings.watch_bot.connected",
      { username: me.username ?? null },
      { source: await headers(), actorId: admin.user.id },
    );
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/settings");
    return { ok: true, username: me.username ?? me.first_name };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "رمز بوت غير صحيح." };
  }
}

export async function disconnectWatchBot() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  const { error } = await supabase
    .from("telegram_bot")
    .update({
      watch_bot_token: null,
      watch_bot_id: null,
      watch_bot_username: null,
    })
    .eq("singleton", true);
  if (error) return { error: error.message };
  await logAudit(
    "settings.watch_bot.disconnected",
    {},
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
