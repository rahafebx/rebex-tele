"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Save, FolderOpen } from "lucide-react";
import { sendTelegramMessage } from "@/app/dashboard/send/actions";
import { createTemplate } from "@/app/dashboard/templates/actions";
import type { TelegramChat, TelegramTopic, MessageTemplate } from "@/lib/types";
import {
  editorHtmlToTelegramHtml,
  telegramSavePayload,
} from "@/lib/telegram/format";
import {
  RichMessageEditor,
  type RichMessageEditorHandle,
} from "@/components/rich-message-editor";
import { Spinner } from "@/components/spinner";
import Input from "./ui/input";
import { Dropdown } from "./ui/dropdown";
import { Button } from "./ui/button";

const topicLabel = (t: TelegramTopic) =>
  t.name ?? `الموضوع ${t.telegram_thread_id}`;

export function SendComposer({
  groups,
  topicsByChat,
  templates,
  initialChatId,
}: {
  groups: TelegramChat[];
  topicsByChat: Record<string, TelegramTopic[]>;
  templates: MessageTemplate[];
  initialChatId?: string;
}) {
  const router = useRouter();
  const editor = useRef<RichMessageEditorHandle>(null);
  const [chatId, setChatId] = useState(initialChatId ?? "");
  const [topicId, setTopicId] = useState("");
  const [preview, setPreview] = useState(true);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [tplId, setTplId] = useState("");
  const chat = groups.find((g) => g.telegram_chat_id === chatId);
  const topics = chat?.is_forum ? (topicsByChat[chatId] ?? []) : [];

  const loadTemplate = (id: string) => {
    setTplId(id);
    if (!id) return;
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    editor.current?.setHTML(tpl.editor_html);
    setTplId("");
  };

  const saveAsTemplate = async () => {
    const html = editor.current?.getHTML() ?? "";
    const response = editorHtmlToTelegramHtml(html).trim();
    if (!response) {
      setStatus({ text: "اكتب رسالة لحفظها كقالب.", error: true });
      return;
    }
    const rawTitle = window.prompt("اسم القالب:");
    const name = rawTitle?.trim();
    if (!name) return;
    setSavingTemplate(true);
    const result = await createTemplate({
      title: name,
      response,
      editorHtml: html,
    });
    setStatus(
      result.error
        ? { text: result.error, error: true }
        : { text: "تم حفظ القالب.", error: false },
    );
    if (!result.error) router.refresh();
    setSavingTemplate(false);
  };
  const submit = async () => {
    const html = editor.current?.getHTML() ?? "";
    const { response, isRich } = telegramSavePayload(html);
    setSending(true);
    const result = await sendTelegramMessage({
      chatId,
      threadId: topicId ? Number(topicId) : undefined,
      html: response,
      linkPreview: preview,
      isRich,
    });
    setStatus(
      result.error
        ? { text: result.error, error: true }
        : { text: "تم إرسال الرسالة.", error: false },
    );
    if (!result.error) editor.current?.clear();
    setSending(false);
  };
  return (
    <div className="mt-8 max-w-3xl rounded-xl border bg-[var(--card)]">
      <div className="grid gap-4 border-b p-5 sm:grid-cols-2">
        <Dropdown
          name="chat"
          label="المجموعة"
          options={groups.map((g) => ({
            value: g.telegram_chat_id,
            label: g.title,
          }))}
          value={chatId}
          onChange={(value) => {
            setChatId(value);
            setTopicId("");
          }}
          placeholder="اختر المجموعة"
        />
        {chat?.is_forum ? (
          <Dropdown
            name="topic"
            label="الموضوع"
            options={topics.map((t) => ({
              value: String(t.telegram_thread_id),
              label: topicLabel(t),
            }))}
            value={topicId}
            onChange={(value) => setTopicId(value)}
            allLabel="عام"
          />
        ) : (
          <Input
            label="الموضوع"
            value=""
            onChange={() => {}}
            dir="rtl"
            disabled={true}
            placeholder={
              chat ? "ليست مجموعة نقاش (المواضيع معطّلة)" : "اختر مجموعة أولاً"
            }
          />
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,9rem)_auto] items-end gap-4 border-b p-5">
        <div className="col-span-2">
          <Dropdown
          label="القالب"
          name="template-select"
          options={templates.map((t) => ({
            value: t.id,
            label: t.title,
          }))}
          value={tplId}
          onChange={loadTemplate}
          placeholder="تحميل قالب..."
        />
        </div>
        <Button
            onClick={saveAsTemplate}
            disabled={savingTemplate || sending}
            className="px-3 py-2 text-[15px]"
          >
            {savingTemplate ? <Spinner /> : <Save size={16} />}
            حفظ كقالب
          </Button>
        <Link
          href="/dashboard/templates"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[15px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          <FolderOpen size={16} /> إدارة القوالب
        </Link>
      </div>

      <RichMessageEditor
        ref={editor}
        placeholder="اكتب رسالتك..."
        minHeight="min-h-52"
      />
      <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-[15px] text-[var(--muted)]">
          <input
            type="checkbox"
            checked={preview}
            onChange={(e) => setPreview(e.target.checked)}
            className="size-4"
          />{" "}
          معاينة الرابط
        </label>
        <div className="flex items-center gap-3">
          {status && (
            <span
              className={`text-[15px] ${status.error ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
            >
              {status.text}
            </span>
          )}
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            disabled={!chatId || sending || savingTemplate}
          >
            {sending && <Spinner />}
            <Send size={17} /> إرسال
          </Button>
        </div>
      </div>
    </div>
  );
}
