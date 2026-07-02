import "server-only";
import { listSubscriptions } from "@/lib/subscriptions";
import { getSettings } from "@/lib/settings";
import { formatCurrency } from "@/lib/currency";
import { sendNtfy } from "@/lib/notify";

/**
 * Send renewal reminders. To avoid nagging every day, a subscription is only
 * included when it renews exactly `lead_days` from now (the heads-up) or today
 * (the day-of reminder). Runs once per day from the scheduler.
 */
export async function runDailyReminders(): Promise<{ sent: number; error?: string }> {
  const settings = getSettings();
  const lead = Number(settings.notify_lead_days) || 0;

  if (!settings.ntfy_topic) return { sent: 0, error: "No ntfy topic configured" };

  const due = listSubscriptions().filter(
    (s) =>
      s.active &&
      s.notify &&
      (s.daysUntil === lead || s.daysUntil === 0),
  );

  if (due.length === 0) return { sent: 0 };

  const lines = due.map((s) => {
    const when = s.daysUntil === 0 ? "today" : `in ${s.daysUntil} days`;
    return `• ${s.name} — ${formatCurrency(s.price, s.currencyCode)} ${when} (${s.nextRenewal})`;
  });

  const title =
    due.length === 1
      ? `${due[0].name} renews ${due[0].daysUntil === 0 ? "today" : `in ${due[0].daysUntil} days`}`
      : `${due.length} subscriptions renewing soon`;

  const error = await sendNtfy(settings.ntfy_server, settings.ntfy_topic, {
    title,
    message: lines.join("\n"),
    tags: ["moneybag"],
    priority: 4,
  });

  return { sent: error ? 0 : due.length, error: error ?? undefined };
}
