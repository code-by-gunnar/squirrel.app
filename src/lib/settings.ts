import "server-only";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/db/seed";

export type AppSettings = {
  base_currency: string;
  notify_lead_days: string;
  theme: string;
  ntfy_server: string;
  ntfy_topic: string;
};

/** Read all settings as a typed object, falling back to defaults for gaps. */
export function getSettings(): AppSettings {
  const rows = db.select().from(settings).all();
  const map = new Map(rows.map((r) => [r.key, r.value ?? ""]));
  return {
    base_currency: map.get("base_currency") || DEFAULT_SETTINGS.base_currency,
    notify_lead_days: map.get("notify_lead_days") || DEFAULT_SETTINGS.notify_lead_days,
    theme: map.get("theme") || DEFAULT_SETTINGS.theme,
    ntfy_server: map.get("ntfy_server") || DEFAULT_SETTINGS.ntfy_server,
    ntfy_topic: map.get("ntfy_topic") ?? DEFAULT_SETTINGS.ntfy_topic,
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
