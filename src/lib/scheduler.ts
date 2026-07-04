import "server-only";
import cron from "node-cron";
import { refreshFxRates } from "@/lib/fx";
import { runDailyReminders } from "@/lib/reminders";
import { runDailyPayments } from "@/lib/payments";

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

  // Warm the FX cache on boot, then record any charges that came due while the
  // server was down (uses the just-warmed rates; runs even if the warm-up failed).
  refreshFxRates()
    .catch((e) => console.error("[squirrel] FX warm-up failed", e))
    .finally(() => {
      runDailyPayments()
        .then((r) => {
          if (r.inserted > 0) console.log(`[squirrel] recorded ${r.inserted} charge(s)`);
        })
        .catch((e) => console.error("[squirrel] payments catch-up failed", e));
    });

  // Refresh exchange rates each morning (ECB publishes ~16:00 CET on weekdays).
  cron.schedule(
    "0 2 * * *",
    () => {
      refreshFxRates().catch((e) => console.error("[squirrel] FX refresh failed", e));
    },
    options,
  );

  // Record the day's due charges into the ledger, just after the FX refresh.
  cron.schedule(
    "5 2 * * *",
    () => {
      runDailyPayments()
        .then((r) => {
          if (r.inserted > 0) console.log(`[squirrel] recorded ${r.inserted} charge(s)`);
        })
        .catch((e) => console.error("[squirrel] payments run failed", e));
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
