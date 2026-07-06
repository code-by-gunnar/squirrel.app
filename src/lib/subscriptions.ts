import "server-only";
import { desc, eq, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  subscriptions,
  categories,
  contexts,
  paymentMethods,
  fxRates,
  type Subscription,
  type Context,
} from "@/db/schema";
import {
  computeNextRenewal,
  daysUntilRenewal,
  daysUntilDate,
  monthlyEquivalent,
  yearlyEquivalent,
  toISODate,
  type BillingCycle,
} from "@/lib/billing";
import { convertToBase, ratesToMap } from "@/lib/currency";
import { getBaseCurrency } from "@/lib/settings";
import type { ContextFilter } from "@/lib/context-filter";

/**
 * A subscription's lifecycle state, derived on read:
 * - `active`    — live and renewing.
 * - `cancelled` — cancelled but still usable until `endsOn` (renewals stopped).
 * - `expired`   — was cancelled and `endsOn` has now passed (reads as inactive).
 * - `inactive`  — manually switched off.
 */
export type SubscriptionStatus = "active" | "cancelled" | "expired" | "inactive";

export type EnrichedSubscription = Subscription & {
  categoryName: string | null;
  categoryColor: string | null;
  contextName: string | null;
  contextColor: string | null;
  paymentMethodName: string | null;
  nextRenewal: string; // ISO date
  daysUntil: number;
  priceBase: number; // the per-charge price converted to base currency
  monthlyBase: number; // monthly cost in base currency
  yearlyBase: number; // yearly cost in base currency
  status: SubscriptionStatus;
  isActive: boolean; // usable AND counted toward totals (active or cancelled-not-expired)
  daysUntilEnd: number | null; // days until `endsOn` for a cancelled sub (null otherwise)
  daysUntilDepletion: number | null; // days until `depletesOn` for a prepaid sub (null if none/not prepaid)
  depleted: boolean; // prepaid AND depletesOn has passed
};

/** Derive lifecycle status + effective-active from the stored flags and dates. */
function deriveStatus(
  active: boolean,
  cancelled: boolean,
  endsOn: string | null,
  from: Date,
): { status: SubscriptionStatus; isActive: boolean; daysUntilEnd: number | null } {
  if (!active) return { status: "inactive", isActive: false, daysUntilEnd: null };
  if (cancelled) {
    const daysUntilEnd = endsOn ? daysUntilDate(endsOn, from) : null;
    if (daysUntilEnd !== null && daysUntilEnd < 0) {
      return { status: "expired", isActive: false, daysUntilEnd };
    }
    return { status: "cancelled", isActive: true, daysUntilEnd };
  }
  return { status: "active", isActive: true, daysUntilEnd: null };
}

export function getCategories() {
  return db.select().from(categories).orderBy(categories.name).all();
}

export function getContexts(): Context[] {
  return db.select().from(contexts).orderBy(contexts.name).all();
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
export function listSubscriptions(
  filter: ContextFilter = "all",
): EnrichedSubscription[] {
  const base = getBaseCurrency();
  const rates = getFxRateMap();
  const from = new Date();

  const where: SQL | undefined =
    filter === "all"
      ? undefined
      : filter === "unassigned"
        ? isNull(subscriptions.contextId)
        : eq(subscriptions.contextId, filter);

  const rows = db
    .select({
      sub: subscriptions,
      categoryName: categories.name,
      categoryColor: categories.color,
      contextName: contexts.name,
      contextColor: contexts.color,
      paymentMethodName: paymentMethods.name,
    })
    .from(subscriptions)
    .leftJoin(categories, eq(subscriptions.categoryId, categories.id))
    .leftJoin(contexts, eq(subscriptions.contextId, contexts.id))
    .leftJoin(paymentMethods, eq(subscriptions.paymentMethodId, paymentMethods.id))
    .where(where)
    .orderBy(desc(subscriptions.active), subscriptions.name)
    .all();

  return rows.map(
    ({ sub, categoryName, categoryColor, contextName, contextColor, paymentMethodName }) => {
      const cycle = sub.billingCycle as BillingCycle;
      const nextRenewal = computeNextRenewal(sub.startDate, cycle, sub.billingInterval, from);
      const monthlyNative = monthlyEquivalent(sub.price, cycle, sub.billingInterval);
      const yearlyNative = yearlyEquivalent(sub.price, cycle, sub.billingInterval);
      const { status, isActive, daysUntilEnd } = deriveStatus(
        sub.active,
        sub.cancelled,
        sub.endsOn,
        from,
      );
      return {
        ...sub,
        categoryName,
        categoryColor,
        contextName,
        contextColor,
        paymentMethodName,
        nextRenewal: toISODate(nextRenewal),
        daysUntil: daysUntilRenewal(sub.startDate, cycle, sub.billingInterval, from),
        priceBase: convertToBase(sub.price, sub.currencyCode, base, rates),
        // A prepaid pack has no recurring monthly cost — its spend lives in the
        // ledger as one-off charges, so it must not feed normalized totals.
        monthlyBase: sub.prepaid ? 0 : convertToBase(monthlyNative, sub.currencyCode, base, rates),
        yearlyBase: sub.prepaid ? 0 : convertToBase(yearlyNative, sub.currencyCode, base, rates),
        status,
        isActive,
        daysUntilEnd,
        daysUntilDepletion: sub.prepaid && sub.depletesOn ? daysUntilDate(sub.depletesOn, from) : null,
        depleted:
          sub.prepaid && sub.depletesOn ? daysUntilDate(sub.depletesOn, from) < 0 : false,
      };
    },
  );
}

export function getSubscription(id: number) {
  return db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
}

/**
 * Null every subscription's `contextId` that points at `id`, then delete the
 * context — atomically in one transaction.
 *
 * IMPORTANT: `context_id` was added via `ALTER TABLE ... REFERENCES` (migration
 * 0004), and SQLite does NOT enforce `ON DELETE SET NULL` for FKs added that
 * way (unlike `categoryId`, whose FK is inline in the original CREATE TABLE).
 * A bare `DELETE FROM contexts` would throw "FOREIGN KEY constraint failed"
 * for any context still assigned to a subscription — so callers must go
 * through this helper instead of deleting the row directly.
 *
 * Extracted out of the `deleteContext` server action so it can be unit-tested
 * directly: the action's `revalidatePath` calls throw outside a Next.js
 * request scope, which makes the action itself awkward to exercise in a
 * plain Vitest test.
 */
export function deleteContextAndUnassign(id: number): void {
  db.transaction((tx) => {
    tx.update(subscriptions)
      .set({ contextId: null })
      .where(eq(subscriptions.contextId, id))
      .run();
    tx.delete(contexts).where(eq(contexts.id, id)).run();
  });
}
