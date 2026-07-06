import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  payments,
  subscriptions,
  categories,
  contexts,
  paymentMethods,
  settings,
} from "@/db/schema";
import { listSubscriptions } from "@/lib/subscriptions";
import { describeCycle, type BillingCycle } from "@/lib/billing";
import { getBaseCurrency } from "@/lib/settings";
import { toCsv } from "@/lib/csv";
import { APP_VERSION } from "@/lib/version";
import { BACKUP_SCHEMA_VERSION, type Backup } from "@/lib/backup";

/**
 * A full, self-contained JSON backup of every user table (fxRates is excluded as
 * a re-fetchable cache). Real IDs are kept so relations survive a restore.
 */
export function buildBackup(): Backup {
  return {
    app: "squirrel",
    schema: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      settings: db.select().from(settings).all(),
      categories: db.select().from(categories).all(),
      contexts: db.select().from(contexts).all(),
      paymentMethods: db.select().from(paymentMethods).all(),
      subscriptions: db.select().from(subscriptions).all(),
      payments: db.select().from(payments).all(),
    },
  };
}

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
    "Context",
    "Payment method",
    "Start date",
    "Next renewal",
    `Monthly (${base})`,
    `Yearly (${base})`,
    "Status",
    "Free",
    "Prepaid",
    "Notes",
  ];

  const rows = subs.map((s) => [
    s.name,
    s.price.toFixed(2),
    s.currencyCode,
    describeCycle(s.billingCycle as BillingCycle, s.billingInterval),
    s.categoryName ?? "",
    s.contextName ?? "",
    s.paymentMethodName ?? "",
    s.startDate,
    s.nextRenewal,
    s.monthlyBase.toFixed(2),
    s.yearlyBase.toFixed(2),
    s.status,
    s.free ? "yes" : "no",
    s.prepaid ? "yes" : "no",
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
