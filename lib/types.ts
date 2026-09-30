export type TelegramChat = {
  id: string;
  telegram_chat_id: string;
  title: string;
  username: string | null;
  type: string;
  is_forum: boolean;
  created_at: string;
};

export type TelegramTopic = {
  id: string;
  telegram_chat_id: string;
  telegram_thread_id: number;
  name: string | null;
  is_manually_named: boolean;
  created_at: string;
};

export type TelegramCommand = {
  id: string;
  command: string;
  description: string;
  response: string;
  editor_html: string;
  is_rich: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ScheduleType = "once" | "daily" | "weekly" | "monthly" | "yearly";

export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  once: "مرة واحدة",
  daily: "يوميًا",
  weekly: "أسبوعيًا",
  monthly: "شهريًا",
  yearly: "سنويًا",
};

export const SCHEDULE_DEFAULT_TITLE = "جدولة جديدة";

export type ScheduledMessage = {
  id: string;
  title: string;
  telegram_chat_id: string;
  telegram_thread_id: number | null;
  schedule_type: ScheduleType;
  send_at: string;
  repeat_until: string | null;
  status: "active" | "paused" | "failed" | "done";
  response: string;
  editor_html: string;
  link_preview: boolean;
  is_rich: boolean;
  next_run_at: string;
  sent_count: number;
  consecutive_failed: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export const SCHED_PAGE_SIZE = 6;

export const SCHEDULE_STATUS_LABELS: Record<ScheduledMessage["status"], string> = {
  active: "نشط",
  paused: "موقوف مؤقتًا",
  failed: "متوقف (فشل متكرر)",
  done: "اكتمل",
};

export const TEMPLATES_PAGE_SIZE = 6;

export type MessageTemplate = {
  id: string;
  title: string;
  response: string;
  editor_html: string;
  created_at: string;
  updated_at: string;
};