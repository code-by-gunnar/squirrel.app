import "server-only";
import { listSubscriptions } from "@/lib/subscriptions";
import { getSettings } from "@/lib/settings";
import { formatCurrency } from "@/lib/currency";
import { CHANNELS, notifyAll } from "@/lib/notify";
import type { ChannelResult } from "@/lib/notify/types";
import { selectReminders } from "@/lib/reminders-select";

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

  const { renewals, topups } = selectReminders(listSubscriptions(), lead);
  const due = [...renewals, ...topups];
  if (due.length === 0) return { sent: 0, results: [] };

  const renewalLines = renewals.map((s) => {
    const when = s.daysUntil === 0 ? "today" : `in ${s.daysUntil} days`;
    return `• ${s.name} — ${formatCurrency(s.price, s.currencyCode)} renews ${when} (${s.nextRenewal})`;
  });
  const topupLines = topups.map((s) => {
    const when = s.daysUntilDepletion === 0 ? "today" : `in ${s.daysUntilDepletion} days`;
    return `• ${s.name} — credits run out ${when} (${s.depletesOn}) — top up soon`;
  });
  const lines = [...renewalLines, ...topupLines];

  const title =
    due.length === 1
      ? renewals.length === 1
        ? `${renewals[0].name} renews ${renewals[0].daysUntil === 0 ? "today" : `in ${renewals[0].daysUntil} days`}`
        : `${topups[0].name} credits run out ${topups[0].daysUntilDepletion === 0 ? "today" : `in ${topups[0].daysUntilDepletion} days`}`
      : `${due.length} subscriptions need attention`;

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
