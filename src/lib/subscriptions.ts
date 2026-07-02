import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  subscriptions,
  categories,
  paymentMethods,
  fxRates,
  type Subscription,
} from "@/db/schema";
import {
  computeNextRenewal,
  daysUntilRenewal,
  monthlyEquivalent,
  yearlyEquivalent,
  toISODate,
  type BillingCycle,
} from "@/lib/billing";
import { convertToBase, ratesToMap } from "@/lib/currency";
import { getBaseCurrency } from "@/lib/settings";

export type EnrichedSubscription = Subscription & {
  categoryName: string | null;
  categoryColor: string | null;
  paymentMethodName: string | null;
  nextRenewal: string; // ISO date
  daysUntil: number;
  priceBase: number; // the per-charge price converted to base currency
  monthlyBase: number; // monthly cost in base currency
  yearlyBase: number; // yearly cost in base currency
};

export function getCategories() {
  return db.select().from(categories).orderBy(categories.name).all();
}

export function getPaymentMethods() {
  return db.select().from(paymentMethods).orderBy(paymentMethods.name).all();
}

export function getFxRateMap() {
  return ratesToMap(db.select().from(fxRates).all());
}

/**
 * Load every subscription joined with its category & payment method, and attach
 * the computed fields the UI needs (next renewal, days until, base-currency cost).
 */
export function listSubscriptions(): EnrichedSubscription[] {
  const base = getBaseCurrency();
  const rates = getFxRateMap();
  const from = new Date();

  const rows = db
    .select({
      sub: subscriptions,
      categoryName: categories.name,
      categoryColor: categories.color,
      paymentMethodName: paymentMethods.name,
    })
    .from(subscriptions)
    .leftJoin(categories, eq(subscriptions.categoryId, categories.id))
    .leftJoin(paymentMethods, eq(subscriptions.paymentMethodId, paymentMethods.id))
    .orderBy(desc(subscriptions.active), subscriptions.name)
    .all();

  return rows.map(({ sub, categoryName, categoryColor, paymentMethodName }) => {
    const cycle = sub.billingCycle as BillingCycle;
    const nextRenewal = computeNextRenewal(sub.startDate, cycle, sub.billingInterval, from);
    const monthlyNative = monthlyEquivalent(sub.price, cycle, sub.billingInterval);
    const yearlyNative = yearlyEquivalent(sub.price, cycle, sub.billingInterval);
    return {
      ...sub,
      categoryName,
      categoryColor,
      paymentMethodName,
      nextRenewal: toISODate(nextRenewal),
      daysUntil: daysUntilRenewal(sub.startDate, cycle, sub.billingInterval, from),
      priceBase: convertToBase(sub.price, sub.currencyCode, base, rates),
      monthlyBase: convertToBase(monthlyNative, sub.currencyCode, base, rates),
      yearlyBase: convertToBase(yearlyNative, sub.currencyCode, base, rates),
    };
  });
}

export function getSubscription(id: number) {
  return db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
}
