import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { telegram } from "@/lib/telegram/client";
import { decryptSecret } from "@/lib/crypto";
import { rateLimit, rateLimitOnce } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

type Update = {
  message?: {
    chat?: { id: number };
    from?: { id: number };
    text?: string;
    message_id?: number;
    message_thread_id?: number;
  };
};

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Command flood protection (in-memory buckets, reset on restart): "warn"
// buckets send exactly one Arabic slow-down notice per window, then commands
// are silently dropped (200 OK, so Telegram never retries). Per-IP is handled
// separately at the top of POST().
const CMD_USER_LIMIT = 10; // commands per 60s per Telegram user
const CMD_CHAT_LIMIT = 30; // commands per 60s per chat
const CMD_GLOBAL_LIMIT = 150; // commands per 60s bot-wide
const CMD_WINDOW_MS = 60_000;
const CMD_RATE_WARNING =
  "لقد أرسلت أوامر كثيرة بسرعة. تريث قليلًا ثم حاول مجددًا.";

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`webhook:${ip}`, 60, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!headerSecret)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = createServiceClient();
  const { data: bot } = await supabase
    .from("telegram_bot")
    .select("bot_token, webhook_secret")
    .eq("singleton", true)
    .maybeSingle();

  // Decrypt the stored secrets. A missing value is treated as "not
  // configured" (200 OK, no retry); a value that cannot be decrypted (wrong
  // key, corruption) fails closed with 403 so Telegram doesn't retry-storm
  // the endpoint.
  let secrets: { botToken: string; webhookSecret: string } | null = null;
  try {
    if (bot?.bot_token && bot?.webhook_secret) {
      const botToken = decryptSecret(bot.bot_token);
      const webhookSecret = decryptSecret(bot.webhook_secret);
      if (botToken && webhookSecret) secrets = { botToken, webhookSecret };
    }
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!secrets) return NextResponse.json({ ok: true });
  if (!safeEqual(headerSecret, secrets.webhookSecret))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let update: Update;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update?.message;
  const text = msg?.text;
  const chatId = msg?.chat?.id;
  const messageId = msg?.message_id;
  const match = text?.trim().match(/^\/([a-zA-Z0-9_]{1,32})(?:@[A-Za-z0-9_]+)?/);
  const command = match ? match[1].toLowerCase() : null;
  if (!command || !chatId) return NextResponse.json({ ok: true });

  const fromId = msg.from?.id;
  const userLimit = fromId
    ? rateLimitOnce(`cmd-user:${fromId}`, CMD_USER_LIMIT, CMD_WINDOW_MS)
    : "ok";
  const chatLimit = rateLimitOnce(`cmd-chat:${chatId}`, CMD_CHAT_LIMIT, CMD_WINDOW_MS);
  const globalLimit = rateLimitOnce("cmd-global", CMD_GLOBAL_LIMIT, CMD_WINDOW_MS);
  if (!(userLimit === "ok" && chatLimit === "ok" && globalLimit === "ok")) {
    if (userLimit === "warn" || chatLimit === "warn" || globalLimit === "warn") {
      try {
        await telegram.sendMessage(secrets.botToken, {
          chat_id: chatId,
          ...(msg.message_thread_id
            ? { message_thread_id: msg.message_thread_id }
            : {}),
          ...(messageId ? { reply_parameters: { message_id: messageId } } : {}),
          text: CMD_RATE_WARNING,
        });
      } catch (e) {
        console.error("rate-limit warning failed:", e);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const { data: cmd } = await supabase
    .from("telegram_commands")
    .select("response, is_rich")
    .eq("command", command)
    .eq("enabled", true)
    .maybeSingle();
  if (!cmd?.response) return NextResponse.json({ ok: true });

  try {
    const common = {
      chat_id: chatId,
      ...(msg.message_thread_id
        ? { message_thread_id: msg.message_thread_id }
        : {}),
      ...(messageId ? { reply_parameters: { message_id: messageId } } : {}),
    };
    if (cmd.is_rich) {
      await telegram.sendRichMessage(secrets.botToken, {
        ...common,
        rich_message: { html: cmd.response, is_rtl: true },
      });
    } else {
      await telegram.sendMessage(secrets.botToken, {
        ...common,
        text: cmd.response,
        parse_mode: "HTML",
      });
    }
  } catch (e) {
    console.error("bot command reply failed:", e);
  }
  return NextResponse.json({ ok: true });
}