"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  contexts,
  paymentMethods,
  subscriptions,
  payments,
  settings,
} from "@/db/schema";
import { saveSettings, getSettings, getBaseCurrency } from "@/lib/settings";
import { deleteContextAndUnassign } from "@/lib/subscriptions";
import { settingsFormSchema } from "@/lib/notify/payloads";
import {
  channelById,
  hasActiveChannel,
  detectTelegramChatId as detectTelegramChatIdLib,
} from "@/lib/notify";
import type { ChannelId } from "@/lib/notify/types";
import { runDailyReminders } from "@/lib/reminders";
import { refreshFxRates } from "@/lib/fx";
import { parseBackup } from "@/lib/backup";
import { parseSubscriptionsCsv, type RowError } from "@/lib/import-csv";
import { backfillPayments } from "@/lib/payments";

export type ActionState = { ok?: boolean; error?: string };

export async function saveGeneralSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = Object.fromEntries(
    [
      "base_currency", "notify_lead_days",
      "ntfy_enabled", "ntfy_server", "ntfy_topic",
      "telegram_enabled", "telegram_bot_token", "telegram_chat_id",
      "email_enabled", "email_smtp_host", "email_smtp_port", "email_smtp_secure",
      "email_smtp_user", "email_smtp_pass", "email_from", "email_to",
    ].map((k) => [k, formData.get(k) ?? ""]),
  );

  const parsed = settingsFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;

  saveSettings({
    base_currency: v.base_currency,
    notify_lead_days: String(v.notify_lead_days),
    ntfy_enabled: v.ntfy_enabled ? "1" : "",
    ntfy_server: v.ntfy_server || "https://ntfy.sh",
    ntfy_topic: v.ntfy_topic,
    telegram_enabled: v.telegram_enabled ? "1" : "",
    telegram_bot_token: v.telegram_bot_token,
    telegram_chat_id: v.telegram_chat_id,
    email_enabled: v.email_enabled ? "1" : "",
    email_smtp_host: v.email_smtp_host,
    email_smtp_port: v.email_smtp_port,
    email_smtp_secure: v.email_smtp_secure ? "1" : "",
    email_smtp_user: v.email_smtp_user,
    email_smtp_pass: v.email_smtp_pass,
    email_from: v.email_from,
    email_to: v.email_to,
  });

  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/subscriptions");
  return { ok: true };
}

/** Send a one-off test through a single channel. */
export async function sendTestNotification(channelId: ChannelId): Promise<ActionState> {
  const s = getSettings();
  const ch = channelById(channelId);
  if (!ch) return { error: "Unknown channel." };
  if (!ch.isConfigured(s)) return { error: `Configure ${ch.label} first.` };
  const err = await ch.send(s, {
    title: "Squirrel test",
    message: "🐿️ Notifications are working! You'll get renewal reminders here.",
    tags: ["white_check_mark"],
  });
  return err ? { error: err } : { ok: true };
}

export async function detectTelegramChatId(
  token: string,
): Promise<{ chatId?: string; error?: string }> {
  return detectTelegramChatIdLib(token.trim());
}

/** Run the renewal-reminder check right now (same logic as the daily job). */
export async function runRemindersNow(): Promise<ActionState & { sent?: number }> {
  const s = getSettings();
  if (!hasActiveChannel(s)) return { error: "Enable and configure a notification channel first." };
  const res = await runDailyReminders();
  if (res.error) return { error: res.error };
  return { ok: true, sent: res.sent };
}

// --- Categories ---

export async function addCategory(name: string, color: string): Promise<ActionState> {
  const n = name.trim();
  if (!n) return { error: "Name required" };
  db.insert(categories).values({ name: n, color: color || "#6366f1" }).run();
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  return { ok: true };
}

export async function updateCategory(
  id: number,
  name: string,
  color: string,
): Promise<ActionState> {
  const n = name.trim();
  if (!n) return { error: "Name required" };
  db.update(categories).set({ name: n, color }).where(eq(categories.id, id)).run();
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteCategory(id: number): Promise<ActionState> {
  db.delete(categories).where(eq(categories.id, id)).run();
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  revalidatePath("/");
  return { ok: true };
}

// --- Contexts ---

export async function addContext(name: string, color: string): Promise<ActionState> {
  const n = name.trim();
  if (!n) return { error: "Name required" };
  db.insert(contexts).values({ name: n, color: color || "#6366f1" }).run();
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  return { ok: true };
}

export async function updateContext(
  id: number,
  name: string,
  color: string,
): Promise<ActionState> {
  const n = name.trim();
  if (!n) return { error: "Name required" };
  db.update(contexts).set({ name: n, color }).where(eq(contexts.id, id)).run();
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteContext(id: number): Promise<ActionState> {
  // IMPORTANT: SQLite's `ALTER TABLE ADD COLUMN ... REFERENCES` (how context_id
  // was added in migration 0004) does NOT enforce ON DELETE SET NULL — unlike
  // categoryId, whose FK is inline in the original CREATE TABLE. So a bare
  // `DELETE FROM contexts` would throw "FOREIGN KEY constraint failed" for any
  // context still assigned. Null the assignments first, then delete —
  // atomically. Done via `deleteContextAndUnassign` (src/lib/subscriptions.ts)
  // rather than inline here so it can be unit-tested without hitting this
  // action's `revalidatePath` calls, which throw outside a request scope.
  deleteContextAndUnassign(id);
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/reports");
  return { ok: true };
}

// --- Payment methods ---

export async function addPaymentMethod(name: string): Promise<ActionState> {
  const n = name.trim();
  if (!n) return { error: "Name required" };
  db.insert(paymentMethods).values({ name: n }).run();
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  return { ok: true };
}

export async function deletePaymentMethod(id: number): Promise<ActionState> {
  db.delete(paymentMethods).where(eq(paymentMethods.id, id)).run();
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  return { ok: true };
}

// --- Backup / restore ---

/**
 * Restore a JSON backup, REPLACING all current data. Validated first, then done
 * in a single transaction (children deleted before parents, parents inserted
 * before children, IDs preserved) so it's atomic: any failure rolls back and
 * leaves the existing data untouched. fxRates is left alone (a re-fetchable cache)
 * and refreshed afterwards for any newly-present currencies.
 */
export async function importBackup(
  json: string,
): Promise<ActionState & { replaced?: number }> {
  const parsed = parseBackup(json);
  if (!parsed.ok) return { error: parsed.error };
  const { data: backup } = parsed;
  const d = backup.data;

  try {
    db.transaction((tx) => {
      tx.delete(payments).run();
      tx.delete(subscriptions).run();
      tx.delete(categories).run();
      tx.delete(paymentMethods).run();
      tx.delete(settings).run();

      if (d.categories.length) tx.insert(categories).values(d.categories).run();
      if (d.paymentMethods.length)
        tx.insert(paymentMethods).values(d.paymentMethods).run();
      if (d.settings.length) tx.insert(settings).values(d.settings).run();
      if (d.subscriptions.length)
        tx.insert(subscriptions).values(d.subscriptions).run();
      if (d.payments.length) tx.insert(payments).values(d.payments).run();
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Restore failed" };
  }

  // Best-effort: correct totals for any currencies new to this backup.
  try {
    await refreshFxRates();
  } catch {
    // the daily job / next read will catch up
  }

  revalidatePath("/");
  revalidatePath("/subscriptions");
  revalidatePath("/calendar");
  revalidatePath("/reports");
  revalidatePath("/settings");
  return { ok: true, replaced: d.subscriptions.length };
}

export type ImportPreview = {
  ready: number;
  skipped: RowError[];
  duplicateNames: string[];
  newCategories: string[];
  newContexts: string[];
  newPaymentMethods: string[];
  headerError?: string;
};

/** Parse + validate an uploaded CSV and cross-reference existing names. No writes. */
export async function previewSubscriptionsCsv(text: string): Promise<ImportPreview> {
  const base = getBaseCurrency();
  const parsed = parseSubscriptionsCsv(text, { baseCurrency: base });
  if (parsed.headerError) {
    return {
      ready: 0, skipped: [], duplicateNames: [],
      newCategories: [], newContexts: [], newPaymentMethods: [], headerError: parsed.headerError,
    };
  }

  const lc = (s: string) => s.toLowerCase();
  const existingSubs = new Set(
    db.select({ name: subscriptions.name }).from(subscriptions).all().map((r) => lc(r.name)),
  );
  const existingCats = new Set(
    db.select({ name: categories.name }).from(categories).all().map((r) => lc(r.name)),
  );
  const existingPms = new Set(
    db.select({ name: paymentMethods.name }).from(paymentMethods).all().map((r) => lc(r.name)),
  );
  const existingCtxs = new Set(
    db.select({ name: contexts.name }).from(contexts).all().map((r) => lc(r.name)),
  );

  const duplicateNames: string[] = [];
  const newCats = new Map<string, string>();
  const newCtxs = new Map<string, string>();
  const newPms = new Map<string, string>();
  for (const row of parsed.ready) {
    if (existingSubs.has(lc(row.name))) duplicateNames.push(row.name);
    if (row.categoryName && !existingCats.has(lc(row.categoryName)))
      newCats.set(lc(row.categoryName), row.categoryName);
    if (row.contextName && !existingCtxs.has(lc(row.contextName)))
      newCtxs.set(lc(row.contextName), row.contextName);
    if (row.paymentMethodName && !existingPms.has(lc(row.paymentMethodName)))
      newPms.set(lc(row.paymentMethodName), row.paymentMethodName);
  }

  return {
    ready: parsed.ready.length,
    skipped: parsed.skipped,
    duplicateNames,
    newCategories: [...newCats.values()],
    newContexts: [...newCtxs.values()],
    newPaymentMethods: [...newPms.values()],
  };
}

/**
 * Import valid rows from a CSV as new subscriptions. Appends (never replaces).
 * Missing categories/payment methods are created inside the transaction; payment
 * history is backfilled per sub afterwards (best-effort; a backfill failure is
 * logged and never rolls back the import). Re-parses the text server-side.
 */
export async function importSubscriptionsCsv(
  text: string,
): Promise<ActionState & { inserted?: number; skipped?: number }> {
  const base = getBaseCurrency();
  const parsed = parseSubscriptionsCsv(text, { baseCurrency: base });
  if (parsed.headerError) return { error: parsed.headerError };
  if (parsed.ready.length === 0) return { error: "No valid rows to import." };

  const newIds: number[] = [];
  try {
    db.transaction((tx) => {
      const catMap = new Map(
        tx.select().from(categories).all().map((c) => [c.name.toLowerCase(), c.id]),
      );
      const pmMap = new Map(
        tx.select().from(paymentMethods).all().map((p) => [p.name.toLowerCase(), p.id]),
      );
      const ctxMap = new Map(
        tx.select().from(contexts).all().map((c) => [c.name.toLowerCase(), c.id]),
      );
      const ensureCat = (name: string): number => {
        const key = name.toLowerCase();
        const found = catMap.get(key);
        if (found != null) return found;
        const id = Number(tx.insert(categories).values({ name }).run().lastInsertRowid);
        catMap.set(key, id);
        return id;
      };
      const ensurePm = (name: string): number => {
        const key = name.toLowerCase();
        const found = pmMap.get(key);
        if (found != null) return found;
        const id = Number(tx.insert(paymentMethods).values({ name }).run().lastInsertRowid);
        pmMap.set(key, id);
        return id;
      };
      const ensureCtx = (name: string): number => {
        const key = name.toLowerCase();
        const found = ctxMap.get(key);
        if (found != null) return found;
        const id = Number(tx.insert(contexts).values({ name }).run().lastInsertRowid);
        ctxMap.set(key, id);
        return id;
      };

      for (const row of parsed.ready) {
        const info = tx
          .insert(subscriptions)
          .values({
            name: row.name,
            url: row.url,
            price: row.price,
            currencyCode: row.currencyCode,
            billingCycle: row.billingCycle,
            billingInterval: row.billingInterval,
            startDate: row.startDate,
            trialEndDate: row.trialEndDate,
            categoryId: row.categoryName ? ensureCat(row.categoryName) : null,
            contextId: row.contextName ? ensureCtx(row.contextName) : null,
            paymentMethodId: row.paymentMethodName ? ensurePm(row.paymentMethodName) : null,
            notes: row.notes,
            free: row.free,
            active: true,
            notify: true,
            cancelled: false,
          })
          .run();
        newIds.push(Number(info.lastInsertRowid));
      }
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Import failed" };
  }

  // Backfill outside the transaction (makes network FX calls). Best-effort.
  for (const id of newIds) {
    try {
      await backfillPayments(id);
    } catch (e) {
      console.error("[squirrel] import backfill failed", e);
    }
  }

  revalidatePath("/");
  revalidatePath("/subscriptions");
  revalidatePath("/calendar");
  revalidatePath("/reports");
  revalidatePath("/settings");
  return { ok: true, inserted: newIds.length, skipped: parsed.skipped.length };
}
