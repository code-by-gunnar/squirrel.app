import { z } from "zod";
import type { AppSettings } from "@/lib/settings";
import type { ChannelId, NotificationMessage } from "./types";

// --- ntfy ---
export function isNtfyConfigured(s: AppSettings): boolean {
  return Boolean(s.ntfy_topic);
}
export function buildNtfyPayload(topic: string, msg: NotificationMessage) {
  const payload: Record<string, unknown> = { topic, title: msg.title, message: msg.message };
  if (msg.tags?.length) payload.tags = msg.tags;
  if (msg.priority) payload.priority = msg.priority;
  if (msg.clickUrl) payload.click = msg.clickUrl;
  return payload;
}

// --- telegram ---
export function isTelegramConfigured(s: AppSettings): boolean {
  return Boolean(s.telegram_bot_token && s.telegram_chat_id);
}
export function buildTelegramPayload(chatId: string, msg: NotificationMessage) {
  return {
    chat_id: chatId,
    text: `*${msg.title}*\n${msg.message}`,
    parse_mode: "Markdown" as const,
    disable_web_page_preview: true,
  };
}

// --- email ---
export function isEmailConfigured(s: AppSettings): boolean {
  return Boolean(s.email_smtp_host && s.email_from && s.email_to);
}
export function buildEmail(from: string, to: string, msg: NotificationMessage) {
  return { from, to, subject: msg.title, text: msg.message };
}

// --- enabled flag ---
export function isChannelEnabled(s: AppSettings, id: ChannelId): boolean {
  return s[`${id}_enabled` as keyof AppSettings] === "1";
}

// --- whole settings form (used by the save action; tested here) ---
// A stored flag is "on" only when it equals "1" (matches isChannelEnabled).
const flag = z.string().transform((v) => v === "1");

export const settingsFormSchema = z.object({
  base_currency: z.string().trim().length(3).toUpperCase(),
  notify_lead_days: z.coerce.number().int().min(0).max(60),

  ntfy_enabled: flag,
  ntfy_server: z.string().trim().url().or(z.literal("")),
  ntfy_topic: z.string().trim().max(120),

  telegram_enabled: flag,
  telegram_bot_token: z.string().trim().max(200),
  telegram_chat_id: z.string().trim().max(64),

  email_enabled: flag,
  email_smtp_host: z.string().trim().max(255),
  email_smtp_port: z.string().trim().max(6),
  email_smtp_secure: flag,
  email_smtp_user: z.string().trim().max(255),
  email_smtp_pass: z.string().max(255),
  email_from: z.string().trim().max(255),
  email_to: z.string().trim().max(255),
});
