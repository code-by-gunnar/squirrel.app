import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, subscriptions, categories } from "@/db/schema";
import { listSubscriptions } from "@/lib/subscriptions";
import { describeCycle, type BillingCycle } from "@/lib/billing";
import { getBaseCurrency } from "@/lib/settings";
import { toCsv } from "@/lib/csv";

/** Current subscriptions with their computed fields, as a CSV snapshot. */
export function buildSubscriptionsCsv(): string {
  const base = getBaseCurrency();
  const subs = listSubscriptions();

  const headers = [
    "Name",
    "Price",
    "Currency",
    "Billing",
    "Category",
    "Payment method",
    "Start date",
    "Next renewal",
    `Monthly (${base})`,
    `Yearly (${base})`,
    "Status",
    "Free",
    "Notes",
  ];

  const rows = subs.map((s) => [
    s.name,
    s.price.toFixed(2),
    s.currencyCode,
    describeCycle(s.billingCycle as BillingCycle, s.billingInterval),
    s.categoryName ?? "",
    s.paymentMethodName ?? "",
    s.startDate,
    s.nextRenewal,
    s.monthlyBase.toFixed(2),
    s.yearlyBase.toFixed(2),
    s.status,
    s.free ? "yes" : "no",
    s.notes ?? "",
  ]);

  return toCsv(headers, rows);
}

/** The full payment ledger (one row per recorded charge), newest first, as CSV. */
export function buildPaymentsCsv(): string {
  const rows = db
    .select({
      paidOn: payments.paidOn,
      name: subscriptions.name,
      category: categories.name,
      amount: payments.amount,
      currencyCode: payments.currencyCode,
      amountBase: payments.amountBase,
      baseCurrency: payments.baseCurrency,
      fxRate: payments.fxRate,
    })
    .from(payments)
    .leftJoin(subscriptions, eq(payments.subscriptionId, subscriptions.id))
    .leftJoin(categories, eq(subscriptions.categoryId, categories.id))
    .orderBy(desc(payments.paidOn), subscriptions.name)
    .all();

  const headers = [
    "Date",
    "Subscription",
    "Category",
    "Amount",
    "Currency",
    "Amount (base)",
    "Base currency",
    "FX rate",
  ];

  const data = rows.map((r) => [
    r.paidOn,
    r.name ?? "(deleted)",
    r.category ?? "",
    r.amount.toFixed(2),
    r.currencyCode,
    r.amountBase.toFixed(2),
    r.baseCurrency,
    r.fxRate,
  ]);

  return toCsv(headers, data);
}
