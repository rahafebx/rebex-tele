"use server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ADMIN_ERROR } from "@/lib/supabase/admin";
import { telegram } from "@/lib/telegram/client";
import { decryptToken, encryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { TelegramCommand } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const COMMAND_RE = /^[a-z0-9_]{1,32}$/;

export async function listCommands(): Promise<
  | { ok: true; items: TelegramCommand[] }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  if (!(await requireAdmin(supabase)))
    return { ok: false, error: ADMIN_ERROR };
  const { data, error } = await supabase
    .from("telegram_commands")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, items: (data ?? []) as TelegramCommand[] };
}

function normalizeCommand(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .split("@")[0]
    .replace(/^\/+/, "");
}

async function syncBotCommands(supabase: Supabase) {
  try {
    const { data: bot } = await supabase
      .from("telegram_bot")
      .select("bot_token")
      .eq("singleton", true)
      .maybeSingle();
    if (!bot?.bot_token) return false;
    const token = decryptToken(bot.bot_token);
    const { data } = await supabase
      .from("telegram_commands")
      .select("command, description")
      .eq("enabled", true)
      .order("command", { ascending: true });
    await telegram.setMyCommands(
      token,
      (data ?? []).map((c) => ({
        command: c.command,
        description: c.description || c.command,
      })),
    );
    return true;
  } catch {
    return false;
  }
}

export async function addCommand(input: {
  command: string;
  description: string;
  response: string;
  editorHtml: string;
  isRich: boolean;
}) {
  const command = normalizeCommand(input.command);
  if (!COMMAND_RE.test(command))
    return { error: "اسم الأمر غير صالح: حروف وأرقام و _ فقط (حتى 32 حرفًا)." };
  const description = input.description.trim().slice(0, 256);
  const response = input.response.trim();
  if (!response) return { error: "اكتب ردًا للأمر أولاً." };
  const supabase = await createClient();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const { data: existing } = await supabase
    .from("telegram_commands")
    .select("id")
    .eq("command", command)
    .maybeSingle();
  if (existing) return { error: "هذا الأمر موجود مسبقًا." };
  const { error } = await supabase.from("telegram_commands").insert({
    command,
    description,
    response,
    editor_html: input.editorHtml,
    is_rich: input.isRich,
  });
  if (error) return { error: error.message };
  await syncBotCommands(supabase);
  revalidatePath("/dashboard/commands");
  return { ok: true };
}

export async function updateCommand(input: {
  id: string;
  command: string;
  description: string;
  response: string;
  editorHtml: string;
  isRich: boolean;
}) {
  const command = normalizeCommand(input.command);
  if (!COMMAND_RE.test(command))
    return { error: "اسم الأمر غير صالح: حروف وأرقام و _ فقط (حتى 32 حرفًا)." };
  const description = input.description.trim().slice(0, 256);
  const response = input.response.trim();
  if (!response) return { error: "اكتب ردًا للأمر أولاً." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const { data: existing } = await supabase
    .from("telegram_commands")
    .select("id")
    .eq("command", command)
    .maybeSingle();
  if (existing && existing.id !== input.id)
    return { error: "هذا الأمر موجود مسبقًا." };
  const { error } = await supabase
    .from("telegram_commands")
    .update({
      command,
      description,
      response,
      editor_html: input.editorHtml,
      is_rich: input.isRich,
    })
    .eq("id", input.id);
  if (error) return { error: error.message };
  await syncBotCommands(supabase);
  revalidatePath("/dashboard/commands");
  return { ok: true };
}

export async function deleteCommand(id: string) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  const { data: existing } = await supabase
    .from("telegram_commands")
    .select("command")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("telegram_commands")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  await logAudit(
    "admin.command.deleted",
    { command: existing?.command ?? null },
    { source: await headers(), actorId: admin.user.id },
  );
  await syncBotCommands(supabase);
  revalidatePath("/dashboard/commands");
  return { ok: true };
}

export async function toggleCommand(id: string, enabled: boolean) {
  const supabase = await createClient();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const { error } = await supabase
    .from("telegram_commands")
    .update({ enabled })
    .eq("id", id);
  if (error) return { error: error.message };
  await syncBotCommands(supabase);
  revalidatePath("/dashboard/commands");
  return { ok: true };
}

export async function connectWebhook(publicUrl: string) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  const { data: bot } = await supabase
    .from("telegram_bot")
    .select("bot_token")
    .eq("singleton", true)
    .maybeSingle();
  if (!bot?.bot_token) return { error: "اربط البوت من الإعدادات أولاً." };
  const raw = publicUrl.trim();
  if (!raw) return { error: "أدخل الرابط العام لتطبيقك." };
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return { error: "الرابط غير صالح." };
  }
  if (!["http:", "https:"].includes(url.protocol))
    return { error: "الرابط يجب أن يبدأ بـ http أو https." };
  const secret = crypto.randomUUID();
  let token: string;
  try {
    token = decryptToken(bot.bot_token);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "تعذّر فك تشفير رمز البوت.",
    };
  }
  try {
    await telegram.setWebhook(token, {
      url: `${url.origin}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "فشل ربط الويب هوك." };
  }
  await supabase
    .from("telegram_bot")
    .update({ webhook_secret: encryptSecret(secret) })
    .eq("singleton", true);
  await logAudit(
    "admin.webhook.connected",
    { host: url.host },
    { source: await headers(), actorId: admin.user.id },
  );
  await syncBotCommands(supabase);
  revalidatePath("/dashboard/commands");
  return { ok: true };
}

export async function disconnectWebhook() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  const { data: bot } = await supabase
    .from("telegram_bot")
    .select("bot_token")
    .eq("singleton", true)
    .maybeSingle();
  if (!bot?.bot_token) return { error: "اربط البوت من الإعدادات أولاً." };
  let token: string;
  try {
    token = decryptToken(bot.bot_token);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "تعذّر فك تشفير رمز البوت.",
    };
  }
  try {
    await telegram.deleteWebhook(token, {
      drop_pending_updates: true,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "فشل فصل الويب هوك." };
  }
  await supabase
    .from("telegram_bot")
    .update({ webhook_secret: null })
    .eq("singleton", true);
  await logAudit(
    "admin.webhook.disconnected",
    {},
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard/commands");
  return { ok: true };
}