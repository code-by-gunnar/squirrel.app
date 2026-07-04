"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  paymentMethods,
  subscriptions,
  payments,
  settings,
} from "@/db/schema";
import { saveSettings, getSettings } from "@/lib/settings";
import { sendNtfy } from "@/lib/notify";
import { runDailyReminders } from "@/lib/reminders";
import { refreshFxRates } from "@/lib/fx";
import { parseBackup } from "@/lib/backup";

export type ActionState = { ok?: boolean; error?: string };

const GeneralSchema = z.object({
  base_currency: z.string().trim().length(3).toUpperCase(),
  notify_lead_days: z.coerce.number().int().min(0).max(60),
  ntfy_server: z.string().trim().url().or(z.literal("")),
  ntfy_topic: z.string().trim().max(120),
});

export async function saveGeneralSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = GeneralSchema.safeParse({
    base_currency: formData.get("base_currency"),
    notify_lead_days: formData.get("notify_lead_days"),
    ntfy_server: formData.get("ntfy_server"),
    ntfy_topic: formData.get("ntfy_topic"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  saveSettings({
    base_currency: parsed.data.base_currency,
    notify_lead_days: String(parsed.data.notify_lead_days),
    ntfy_server: parsed.data.ntfy_server || "https://ntfy.sh",
    ntfy_topic: parsed.data.ntfy_topic,
  });

  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/subscriptions");
  return { ok: true };
}

export async function sendTestNotification(): Promise<ActionState> {
  const s = getSettings();
  if (!s.ntfy_topic) return { error: "Set an ntfy topic first." };
  const err = await sendNtfy(s.ntfy_server, s.ntfy_topic, {
    title: "Squirrel test",
    message: "🐿️ Notifications are working! You'll get renewal reminders here.",
    tags: ["white_check_mark"],
  });
  return err ? { error: err } : { ok: true };
}

/** Run the renewal-reminder check right now (same logic as the daily job). */
export async function runRemindersNow(): Promise<ActionState & { sent?: number }> {
  const s = getSettings();
  if (!s.ntfy_topic) return { error: "Set an ntfy topic first." };
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
