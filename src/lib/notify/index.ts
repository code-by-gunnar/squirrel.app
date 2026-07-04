import "server-only";
import nodemailer from "nodemailer";
import type { AppSettings } from "@/lib/settings";
import {
  type ChannelId,
  type ChannelResult,
  type NotificationChannel,
  type NotificationMessage,
  CHANNEL_LABELS,
} from "./types";
import {
  buildEmail,
  buildNtfyPayload,
  buildTelegramPayload,
  isChannelEnabled,
  isEmailConfigured,
  isNtfyConfigured,
  isTelegramConfigured,
} from "./payloads";

/**
 * Publish to an ntfy topic. Kept as a standalone export (its signature predates
 * the registry) so existing call sites keep working. Uses ntfy's JSON API so
 * UTF-8 titles (accents/emoji) survive — headers must be ASCII.
 */
export async function sendNtfy(
  server: string,
  topic: string,
  msg: NotificationMessage,
): Promise<string | null> {
  if (!topic) return "No ntfy topic configured.";
  const baseUrl = (server || "https://ntfy.sh").replace(/\/+$/, "");
  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildNtfyPayload(topic, msg)),
    });
    if (!res.ok) return `ntfy responded ${res.status} ${res.statusText}`;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Failed to reach ntfy server";
  }
}

async function sendTelegram(s: AppSettings, msg: NotificationMessage): Promise<string | null> {
  const url = `https://api.telegram.org/bot${s.telegram_bot_token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildTelegramPayload(s.telegram_chat_id, msg)),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      return `Telegram error: ${body?.description ?? `${res.status} ${res.statusText}`}`;
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Failed to reach Telegram";
  }
}

async function sendEmail(s: AppSettings, msg: NotificationMessage): Promise<string | null> {
  try {
    const port = Number(s.email_smtp_port) || 587;
    const transport = nodemailer.createTransport({
      host: s.email_smtp_host,
      port,
      secure: s.email_smtp_secure === "1",
      auth: s.email_smtp_user ? { user: s.email_smtp_user, pass: s.email_smtp_pass } : undefined,
    });
    await transport.sendMail(buildEmail(s.email_from, s.email_to, msg));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Failed to send email";
  }
}

export const CHANNELS: NotificationChannel[] = [
  {
    id: "ntfy",
    label: CHANNEL_LABELS.ntfy,
    isEnabled: (s) => isChannelEnabled(s, "ntfy"),
    isConfigured: isNtfyConfigured,
    send: (s, m) => sendNtfy(s.ntfy_server, s.ntfy_topic, m),
  },
  {
    id: "telegram",
    label: CHANNEL_LABELS.telegram,
    isEnabled: (s) => isChannelEnabled(s, "telegram"),
    isConfigured: isTelegramConfigured,
    send: sendTelegram,
  },
  {
    id: "email",
    label: CHANNEL_LABELS.email,
    isEnabled: (s) => isChannelEnabled(s, "email"),
    isConfigured: isEmailConfigured,
    send: sendEmail,
  },
];

export function channelById(id: ChannelId): NotificationChannel | undefined {
  return CHANNELS.find((c) => c.id === id);
}

export function hasActiveChannel(s: AppSettings): boolean {
  return CHANNELS.some((c) => c.isEnabled(s) && c.isConfigured(s));
}

/** Send to every enabled+configured channel. One channel failing never blocks another. */
export async function notifyAll(
  s: AppSettings,
  msg: NotificationMessage,
): Promise<ChannelResult[]> {
  const results: ChannelResult[] = [];
  for (const ch of CHANNELS) {
    if (!ch.isEnabled(s) || !ch.isConfigured(s)) continue;
    let error: string | null;
    try {
      error = await ch.send(s, msg);
    } catch (e) {
      error = e instanceof Error ? e.message : "Channel send failed";
    }
    results.push({ id: ch.id, label: ch.label, error });
  }
  return results;
}

/** Read the most recent chat id from the bot's pending updates (friction reducer). */
export async function detectTelegramChatId(
  token: string,
): Promise<{ chatId?: string; error?: string }> {
  if (!token) return { error: "Enter a bot token first." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: Array<Record<string, unknown>> }
      | null;
    if (!res.ok || !body?.ok) return { error: "Could not reach Telegram. Check the token." };
    const updates = body.result ?? [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i] as { message?: { chat?: { id?: number } }; channel_post?: { chat?: { id?: number } } };
      const id = u.message?.chat?.id ?? u.channel_post?.chat?.id;
      if (id != null) return { chatId: String(id) };
    }
    return { error: "No messages found. Send your bot a message, then retry." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to reach Telegram" };
  }
}
