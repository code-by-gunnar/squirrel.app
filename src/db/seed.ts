import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { categories, contexts, paymentMethods, settings } from "./schema";

/** Application setting defaults, written on first run only. */
export const DEFAULT_SETTINGS: Record<string, string> = {
  base_currency: process.env.BASE_CURRENCY ?? "GBP",
  notify_lead_days: "3",
  theme: "system",
  ntfy_enabled: "1",
  ntfy_server: "https://ntfy.sh",
  ntfy_topic: "",
  telegram_enabled: "",
  telegram_bot_token: "",
  telegram_chat_id: "",
  email_enabled: "",
  email_smtp_host: "",
  email_smtp_port: "",
  email_smtp_secure: "",
  email_smtp_user: "",
  email_smtp_pass: "",
  email_from: "",
  email_to: "",
};

const DEFAULT_CATEGORIES: { name: string; color: string }[] = [
  { name: "Streaming", color: "#ef4444" },
  { name: "Software", color: "#6366f1" },
  { name: "Music", color: "#f59e0b" },
  { name: "Gaming", color: "#10b981" },
  { name: "Utilities", color: "#0ea5e9" },
  { name: "Health & Fitness", color: "#ec4899" },
  { name: "News & Reading", color: "#8b5cf6" },
  { name: "Other", color: "#64748b" },
];

const DEFAULT_CONTEXTS: { name: string; color: string }[] = [
  { name: "Personal", color: "#6366f1" },
  { name: "Work", color: "#0ea5e9" },
];

const DEFAULT_PAYMENT_METHODS = ["Credit Card", "Debit Card", "PayPal", "Bank Transfer"];

/**
 * Idempotently populate reference data. Safe to call on every startup:
 * settings use INSERT OR IGNORE, and category/method seeds only run when empty.
 */
export function seedDefaults(db: BetterSQLite3Database<Record<string, unknown>>) {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    db.run(
      sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, ${value})`,
    );
  }

  const catCount = db.get<{ c: number }>(sql`SELECT COUNT(*) as c FROM categories`);
  if (!catCount || catCount.c === 0) {
    db.insert(categories).values(DEFAULT_CATEGORIES).run();
  }

  const ctxCount = db.get<{ c: number }>(sql`SELECT COUNT(*) as c FROM contexts`);
  if (!ctxCount || ctxCount.c === 0) {
    db.insert(contexts).values(DEFAULT_CONTEXTS).run();
  }

  const pmCount = db.get<{ c: number }>(
    sql`SELECT COUNT(*) as c FROM payment_methods`,
  );
  if (!pmCount || pmCount.c === 0) {
    db.insert(paymentMethods)
      .values(DEFAULT_PAYMENT_METHODS.map((name) => ({ name })))
      .run();
  }
}
