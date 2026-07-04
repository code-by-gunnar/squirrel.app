import "server-only";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/db/seed";

export type AppSettings = {
  base_currency: string;
  notify_lead_days: string;
  theme: string;
  ntfy_enabled: string;
  ntfy_server: string;
  ntfy_topic: string;
  telegram_enabled: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  email_enabled: string;
  email_smtp_host: string;
  email_smtp_port: string;
  email_smtp_secure: string;
  email_smtp_user: string;
  email_smtp_pass: string;
  email_from: string;
  email_to: string;
};

/** Read all settings as a typed object, falling back to defaults for gaps. */
export function getSettings(): AppSettings {
  const rows = db.select().from(settings).all();
  const map = new Map(rows.map((r) => [r.key, r.value ?? ""]));
  return {
    base_currency: map.get("base_currency") || DEFAULT_SETTINGS.base_currency,
    notify_lead_days: map.get("notify_lead_days") || DEFAULT_SETTINGS.notify_lead_days,
    theme: map.get("theme") || DEFAULT_SETTINGS.theme,
    ntfy_enabled: map.get("ntfy_enabled") ?? DEFAULT_SETTINGS.ntfy_enabled,
    ntfy_server: map.get("ntfy_server") || DEFAULT_SETTINGS.ntfy_server,
    ntfy_topic: map.get("ntfy_topic") ?? DEFAULT_SETTINGS.ntfy_topic,
    telegram_enabled: map.get("telegram_enabled") ?? "",
    telegram_bot_token: map.get("telegram_bot_token") ?? "",
    telegram_chat_id: map.get("telegram_chat_id") ?? "",
    email_enabled: map.get("email_enabled") ?? "",
    email_smtp_host: map.get("email_smtp_host") ?? "",
    email_smtp_port: map.get("email_smtp_port") ?? "",
    email_smtp_secure: map.get("email_smtp_secure") ?? "",
    email_smtp_user: map.get("email_smtp_user") ?? "",
    email_smtp_pass: map.get("email_smtp_pass") ?? "",
    email_from: map.get("email_from") ?? "",
    email_to: map.get("email_to") ?? "",
  };
}

export function getBaseCurrency(): string {
  return getSettings().base_currency;
}

/** Upsert a batch of settings. */
export function saveSettings(values: Record<string, string>) {
  const entries = Object.entries(values);
  db.transaction((tx) => {
    for (const [key, value] of entries) {
      tx
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } })
        .run();
    }
  });
}
