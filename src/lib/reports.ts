import "server-only";
import { db } from "@/db";
import { payments, subscriptions, categories } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";
import { listSubscriptions } from "@/lib/subscriptions";
import { renewalsInRange, toISODate, type BillingCycle } from "@/lib/billing";
import { subscriptionIdsForContext, type ContextFilter } from "@/lib/contexts";

export type MonthEntry = {
  subId: number;
  name: string;
  logoUrl: string | null;
  categoryColor: string | null;
  amount: number;   // base currency
  date: string;     // ISO "YYYY-MM-DD" — charged (billed) or scheduled (forecast)
  kind: "billed" | "forecast";
};

export type MonthlySpend = {
  month: string;    // "YYYY-MM"
  label: string;    // "Jul 26"
  recorded: number; // Σ billed items
  forecast: number; // Σ forecast items
  total: number;    // recorded + forecast
  items: MonthEntry[];
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
 * Spend per calendar month in the base currency, split into `recorded` (actual
 * charges from the ledger) and `forecast` (scheduled charges not yet billed),
 * each with the per-sub line items behind it. The forecast runs from TODAY
 * through the projected window, so the remainder of the CURRENT month is counted
 * (an annual sub due later this month is no longer invisible). A scheduled charge
 * that is already in the ledger is not double-counted.
 *
 * Context scoping attributes spend by each sub's CURRENT context (the ledger has
 * none of its own) — same lens semantics as the rest of Reports.
 */
export function getMonthlySpend(
  filter: ContextFilter = "all",
  months = 12,
  projectedMonths = 3,
  now: Date = new Date(),
): MonthlySpend[] {
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const ids = subscriptionIdsForContext(filter); // null = all
  const scopedEmpty = ids !== null && ids.length === 0;

  // --- Billed items: the ledger joined for name/logo/colour ---
  const billedByMonth = new Map<string, MonthEntry[]>();
  const billedKeys = new Set<string>(); // `${subId}|${date}` — to dedupe forecast
  if (!scopedEmpty) {
    const rows = db
      .select({
        subId: payments.subscriptionId,
        paidOn: payments.paidOn,
        amountBase: payments.amountBase,
        name: subscriptions.name,
        logoUrl: subscriptions.logoUrl,
        categoryColor: categories.color,
      })
      .from(payments)
      .innerJoin(subscriptions, eq(payments.subscriptionId, subscriptions.id))
      .leftJoin(categories, eq(subscriptions.categoryId, categories.id))
      .where(ids === null ? undefined : inArray(payments.subscriptionId, ids))
      .all();
    for (const r of rows) {
      const key = r.paidOn.slice(0, 7);
      const list = billedByMonth.get(key) ?? [];
      list.push({
        subId: r.subId, name: r.name, logoUrl: r.logoUrl,
        categoryColor: r.categoryColor, amount: r.amountBase,
        date: r.paidOn, kind: "billed",
      });
      billedByMonth.set(key, list);
      billedKeys.add(`${r.subId}|${r.paidOn}`);
    }
  }

  // --- Forecast items: scheduled renewals from today through the window ---
  const forecastByMonth = new Map<string, MonthEntry[]>();
  if (!scopedEmpty) {
    const subs = listSubscriptions(filter).filter(
      (s) => s.status === "active" && !s.free && !s.prepaid,
    );
    const forecastStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const forecastEnd = new Date(now.getFullYear(), now.getMonth() + projectedMonths + 1, 0);
    for (const s of subs) {
      const dates = renewalsInRange(
        s.startDate, s.billingCycle as BillingCycle, s.billingInterval,
        forecastStart, forecastEnd,
      );
      for (const d of dates) {
        const iso = toISODate(d);
        if (billedKeys.has(`${s.id}|${iso}`)) continue; // already recorded
        const key = monthKey(d);
        const list = forecastByMonth.get(key) ?? [];
        list.push({
          subId: s.id, name: s.name, logoUrl: s.logoUrl,
          categoryColor: s.categoryColor, amount: s.priceBase,
          date: iso, kind: "forecast",
        });
        forecastByMonth.set(key, list);
      }
    }
  }

  // --- Assemble: `months` past+current, then `projectedMonths` future ---
  const series: MonthlySpend[] = [];
  for (let i = months - 1; i >= -projectedMonths; i--) {
    const d = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - i, 1);
    const key = monthKey(d);
    const billed = billedByMonth.get(key) ?? [];
    const forecast = forecastByMonth.get(key) ?? [];
    const recorded = round2(billed.reduce((sum, e) => sum + e.amount, 0));
    const forecastTotal = round2(forecast.reduce((sum, e) => sum + e.amount, 0));
    const items = [...billed, ...forecast].sort((a, b) => a.date.localeCompare(b.date));
    series.push({
      month: key,
      label: monthLabel(key),
      recorded,
      forecast: forecastTotal,
      total: round2(recorded + forecastTotal),
      items,
    });
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
