import "server-only";
import { listSubscriptions } from "@/lib/subscriptions";
import { getSettings } from "@/lib/settings";
import { formatCurrency } from "@/lib/currency";
import { CHANNELS, notifyAll } from "@/lib/notify";
import type { ChannelResult } from "@/lib/notify/types";

/**
 * Send renewal reminders to every enabled+configured channel. A subscription is
 * only included when it renews exactly `lead_days` from now (the heads-up) or
 * today (the day-of reminder). Runs once per day from the scheduler.
 */
export async function runDailyReminders(): Promise<{
  sent: number;
  results: ChannelResult[];
  error?: string;
}> {
  const settings = getSettings();
  const lead = Number(settings.notify_lead_days) || 0;

  const anyActive = CHANNELS.some((c) => c.isEnabled(settings) && c.isConfigured(settings));
  if (!anyActive) return { sent: 0, results: [], error: "No notification channel enabled" };

  const due = listSubscriptions().filter(
    (s) =>
      s.status === "active" &&
      !s.free &&
      s.notify &&
      (s.daysUntil === lead || s.daysUntil === 0),
  );

  if (due.length === 0) return { sent: 0, results: [] };

  const lines = due.map((s) => {
    const when = s.daysUntil === 0 ? "today" : `in ${s.daysUntil} days`;
    return `• ${s.name} — ${formatCurrency(s.price, s.currencyCode)} ${when} (${s.nextRenewal})`;
  });

  const title =
    due.length === 1
      ? `${due[0].name} renews ${due[0].daysUntil === 0 ? "today" : `in ${due[0].daysUntil} days`}`
      : `${due.length} subscriptions renewing soon`;

  const results = await notifyAll(settings, {
    title,
    message: lines.join("\n"),
    tags: ["moneybag"],
    priority: 4,
  });

  const delivered = results.some((r) => r.error === null);
  const firstError = results.find((r) => r.error)?.error;
  return {
    sent: delivered ? due.length : 0,
    results,
    error: delivered ? undefined : firstError ?? "All channels failed",
  };
}
