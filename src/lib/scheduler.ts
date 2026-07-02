import "server-only";
import cron from "node-cron";
import { refreshFxRates } from "@/lib/fx";
import { runDailyReminders } from "@/lib/reminders";

let started = false;

/**
 * Start the in-process daily jobs. Idempotent — guarded so Next.js hot reloads
 * don't stack duplicate schedules. Replaces Wallos' external cron container.
 */
export function startScheduler() {
  if (started) return;
  started = true;

  const timezone = process.env.TZ;
  const options = timezone ? { timezone } : undefined;

  // Warm the FX cache on boot so totals are correct immediately.
  refreshFxRates().catch((e) => console.error("[squirrel] FX warm-up failed", e));

  // Refresh exchange rates each morning (ECB publishes ~16:00 CET on weekdays).
  cron.schedule(
    "0 2 * * *",
    () => {
      refreshFxRates().catch((e) => console.error("[squirrel] FX refresh failed", e));
    },
    options,
  );

  // Send renewal reminders each morning.
  cron.schedule(
    "0 9 * * *",
    () => {
      runDailyReminders()
        .then((r) => {
          if (r.sent > 0) console.log(`[squirrel] sent ${r.sent} renewal reminder(s)`);
        })
        .catch((e) => console.error("[squirrel] reminder run failed", e));
    },
    options,
  );

  console.log("[squirrel] scheduler started");
}
