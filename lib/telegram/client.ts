const API = "https://api.telegram.org";

export class TelegramError extends Error {
  constructor(
    message: string,
    public description = message,
  ) {
    super(message);
  }
}

async function call<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const json = await response.json();
  if (!json.ok)
    throw new TelegramError(
      json.description ?? "Telegram request failed",
      json.description,
    );
  return json.result as T;
}

export type TelegramUser = {
  id: number;
  username?: string;
  first_name: string;
};
export type TelegramChatResult = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  is_forum?: boolean;
};

export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

export type TelegramTopicEvent = { name?: string; message_thread_id?: number };
export type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: { id: number };
    is_topic_message?: boolean;
    message_thread_id?: number;
    // Unix seconds. Not used for display — it is the only way to tell whether
    // Telegram is describing a topic *after* the admin dismissed it, which is
    // how a mistaken dismissal heals instead of being permanent. See
    // telegram_topic_dismissals.
    date?: number;
    forum_topic_created?: TelegramTopicEvent;
    forum_topic_edited?: TelegramTopicEvent;
  };
};

export const telegram = {
  getMe: (token: string) => call<TelegramUser>(token, "getMe"),
  getChat: (token: string, chatId: string) =>
    call<TelegramChatResult>(token, "getChat", { chat_id: chatId }),
  getUpdates: (token: string, params: Record<string, unknown>) =>
    call<TelegramUpdate[]>(token, "getUpdates", params),
  getWebhookInfo: (token: string) =>
    call<TelegramWebhookInfo>(token, "getWebhookInfo"),
  sendMessage: (token: string, body: Record<string, unknown>) =>
    call(token, "sendMessage", body),
  sendRichMessage: (token: string, body: Record<string, unknown>) =>
    call(token, "sendRichMessage", body),
  setMyCommands: (
    token: string,
    commands: { command: string; description: string }[],
  ) => call(token, "setMyCommands", { commands }),
  setWebhook: (token: string, body: Record<string, unknown>) =>
    call(token, "setWebhook", body),
  deleteWebhook: (token: string, body: Record<string, unknown>) =>
    call(token, "deleteWebhook", body),
};
