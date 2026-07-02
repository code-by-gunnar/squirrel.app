/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * We use it to kick off the in-process cron scheduler (FX + reminders).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
