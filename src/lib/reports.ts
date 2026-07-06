import "server-only";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { listSubscriptions } from "@/lib/subscriptions";
import { renewalsInRange, type BillingCycle } from "@/lib/billing";
import { subscriptionIdsForContext, type ContextFilter } from "@/lib/contexts";

export type MonthlySpend = {
  month: string; // "YYYY-MM"
  label: string; // "Apr 26"
  total: number; // base currency
  projected: boolean; // future estimate vs recorded fact
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

/**
 * Spend per calendar month in the base currency: the last `months` months from
 * recorded charges (actual cashflow — a yearly sub spikes in its renewal month),
 * followed by `projectedMonths` future months estimated from each active sub's
 * schedule. The current month reflects charges recorded so far.
 *
 * When `filter` scopes to a context, spend is attributed by the subscription's
 * CURRENT context (the `payments` ledger has no context of its own). Reassigning
 * a sub's context therefore retroactively moves its past cashflow between
 * contexts — intended, since a context is a live lens over your subscriptions.
 */
export function getMonthlySpend(
  filter: ContextFilter = "all",
  months = 12,
  projectedMonths = 3,
): MonthlySpend[] {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const ids = subscriptionIdsForContext(filter); // null = all
  // An active context with zero subs => no charges in scope.
  const scopedEmpty = ids !== null && ids.length === 0;

  // Past + current: sum recorded charges by month, scoped to the context.
  const byMonth = new Map<string, number>();
  if (!scopedEmpty) {
    const rows = db
      .select({ paidOn: payments.paidOn, amountBase: payments.amountBase })
      .from(payments)
      .where(ids === null ? undefined : inArray(payments.subscriptionId, ids))
      .all();
    for (const r of rows) {
      const key = r.paidOn.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + r.amountBase);
    }
  }

  const series: MonthlySpend[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - i, 1);
    const key = monthKey(d);
    series.push({ month: key, label: monthLabel(key), total: round2(byMonth.get(key) ?? 0), projected: false });
  }

  // Future: estimate scheduled charges per month from the compute-on-read schedule.
  if (projectedMonths > 0) {
    const subs = listSubscriptions(filter).filter(
      (s) => s.status === "active" && !s.free && !s.prepaid,
    );
    const rangeStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth() + 1, 1);
    const rangeEnd = new Date(thisMonth.getFullYear(), thisMonth.getMonth() + 1 + projectedMonths, 0);
    const proj = new Map<string, number>();
    for (const s of subs) {
      const dates = renewalsInRange(
        s.startDate,
        s.billingCycle as BillingCycle,
        s.billingInterval,
        rangeStart,
        rangeEnd,
      );
      for (const d of dates) {
        const key = monthKey(d);
        proj.set(key, (proj.get(key) ?? 0) + s.priceBase);
      }
    }
    for (let i = 1; i <= projectedMonths; i++) {
      const d = new Date(thisMonth.getFullYear(), thisMonth.getMonth() + i, 1);
      const key = monthKey(d);
      series.push({ month: key, label: monthLabel(key), total: round2(proj.get(key) ?? 0), projected: true });
    }
  }

  return series;
}

/** All-time and current-year spend totals in the base currency, from the ledger. */
export function getSpendTotals(
  filter: ContextFilter = "all",
): { allTime: number; thisYear: number } {
  const year = `${new Date().getFullYear()}-`;
  const ids = subscriptionIdsForContext(filter);
  if (ids !== null && ids.length === 0) return { allTime: 0, thisYear: 0 };

  let allTime = 0;
  let thisYear = 0;
  const rows = db
    .select({ paidOn: payments.paidOn, amountBase: payments.amountBase })
    .from(payments)
    .where(ids === null ? undefined : inArray(payments.subscriptionId, ids))
    .all();
  for (const r of rows) {
    allTime += r.amountBase;
    if (r.paidOn.startsWith(year)) thisYear += r.amountBase;
  }
  return { allTime: round2(allTime), thisYear: round2(thisYear) };
}
