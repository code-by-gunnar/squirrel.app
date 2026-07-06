import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  subscriptions,
  payments,
  fxRates,
  type Subscription,
  type NewPayment,
} from "@/db/schema";
import { chargeDates, type BillingCycle } from "@/lib/billing";
import { ratesToMap, rateForDate } from "@/lib/currency";
import { getBaseCurrency } from "@/lib/settings";
import { getRatesForRange } from "@/lib/fx";

/** The ISO dates a subscription has been charged on, up to `from`. */
export function occurrenceDates(sub: Subscription, from: Date = new Date()): string[] {
  return chargeDates(
    {
      startDate: sub.startDate,
      cycle: sub.billingCycle as BillingCycle,
      interval: sub.billingInterval,
      free: sub.free,
      cancelled: sub.cancelled,
      endsOn: sub.endsOn,
    },
    from,
  );
}

function currentRateMap() {
  return ratesToMap(db.select().from(fxRates).all());
}

/** Load a single subscription row, or null. */
function loadSub(subId: number): Subscription | null {
  return (
    db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get() ?? null
  );
}

/** Remove every recorded charge for a subscription (e.g. when it becomes free). */
export function deletePaymentsForSub(subId: number): void {
  db.delete(payments).where(eq(payments.subscriptionId, subId)).run();
}

/**
 * Record every past charge for a subscription that isn't already in the ledger,
 * snapshotting the FX rate that applied on each charge date (historical rates
 * fetched in one request; nearest prior working day fills weekends/holidays).
 * Idempotent via the unique (subscription, date) index.
 */
export async function backfillPayments(subId: number): Promise<void> {
  const sub = loadSub(subId);
  if (!sub || sub.free || sub.prepaid) return;

  const dates = occurrenceDates(sub);
  if (dates.length === 0) return;

  const base = getBaseCurrency();
  const sameCurrency = sub.currencyCode === base;

  // Historical rates for the whole span (one call), plus a current-rate fallback
  // for any date the series doesn't cover (e.g. before ECB data begins).
  const historical = sameCurrency
    ? new Map<string, number>()
    : await getRatesForRange(sub.currencyCode, base, dates[0], dates[dates.length - 1]);
  const fallback = sameCurrency ? 1 : currentRateMap().get(sub.currencyCode) ?? 1;

  const rows: NewPayment[] = dates.map((paidOn) => {
    const rate = sameCurrency ? 1 : rateForDate(historical, paidOn) ?? fallback;
    return {
      subscriptionId: sub.id,
      paidOn,
      amount: sub.price,
      currencyCode: sub.currencyCode,
      amountBase: sub.price * rate,
      baseCurrency: base,
      fxRate: rate,
    };
  });

  db.insert(payments).values(rows).onConflictDoNothing().run();
}

/**
 * Record a single prepaid top-up as a ledger charge on `paidOn`, snapshotting the
 * FX rate for that date. If a charge already exists for this sub on this date
 * (the unique index), the amounts are SUMMED into it — so two top-ups on the same
 * day read as one day's spend and the monthly total stays correct.
 */
export async function recordTopUp(
  subId: number,
  paidOn: string,
  amount: number,
  currencyCode: string,
): Promise<void> {
  const base = getBaseCurrency();
  const sameCurrency = currencyCode === base;

  let rate = 1;
  if (!sameCurrency) {
    const historical = await getRatesForRange(currencyCode, base, paidOn, paidOn);
    rate = rateForDate(historical, paidOn) ?? currentRateMap().get(currencyCode) ?? 1;
  }
  const amountBase = amount * rate;

  db.insert(payments)
    .values({
      subscriptionId: subId,
      paidOn,
      amount,
      currencyCode,
      amountBase,
      baseCurrency: base,
      fxRate: rate,
    })
    .onConflictDoUpdate({
      target: [payments.subscriptionId, payments.paidOn],
      set: {
        amount: sql`${payments.amount} + ${amount}`,
        amountBase: sql`${payments.amountBase} + ${amountBase}`,
      },
    })
    .run();
}

/**
 * Wipe and rebuild a subscription's ledger. Used only when the *schedule*
 * changes (start date / cycle / interval), never on a price change — past rows
 * are real historical facts and must survive a price edit.
 */
export async function rebuildPaymentsForSub(subId: number): Promise<void> {
  deletePaymentsForSub(subId);
  await backfillPayments(subId);
}

/**
 * Append any charges that have come due but aren't recorded yet, using today's
 * cached FX rate. Runs daily from the scheduler (and once on boot to catch up
 * missed days). Idempotent — only genuinely new dates are inserted.
 */
export async function runDailyPayments(): Promise<{ inserted: number; error?: string }> {
  try {
    const base = getBaseCurrency();
    const rates = currentRateMap();
    const subs = db.select().from(subscriptions).all();
    const from = new Date();
    const rows: NewPayment[] = [];

    for (const sub of subs) {
      if (!sub.active || sub.free || sub.prepaid) continue;
      const dates = occurrenceDates(sub, from);
      if (dates.length === 0) continue;

      const existing = new Set(
        db
          .select({ paidOn: payments.paidOn })
          .from(payments)
          .where(eq(payments.subscriptionId, sub.id))
          .all()
          .map((r) => r.paidOn),
      );

      const rate = sub.currencyCode === base ? 1 : rates.get(sub.currencyCode) ?? 1;
      for (const paidOn of dates) {
        if (existing.has(paidOn)) continue;
        rows.push({
          subscriptionId: sub.id,
          paidOn,
          amount: sub.price,
          currencyCode: sub.currencyCode,
          amountBase: sub.price * rate,
          baseCurrency: base,
          fxRate: rate,
        });
      }
    }

    if (rows.length) db.insert(payments).values(rows).onConflictDoNothing().run();
    return { inserted: rows.length };
  } catch (e) {
    return { inserted: 0, error: e instanceof Error ? e.message : "payments job failed" };
  }
}
