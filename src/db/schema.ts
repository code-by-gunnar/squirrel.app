import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Categories a subscription can belong to (e.g. "Streaming", "Software").
 * `color` is a hex string used for chart series and badges.
 */
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
});

/**
 * A subscription's context / area of life (e.g. "Personal", "Work"). Orthogonal
 * to `categories`: category is *what kind of thing*, context is *which area pays
 * for it*. `color` is a hex string used for the badge dot.
 */
export const contexts = sqliteTable("contexts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
});

/** How a subscription is paid (e.g. "Visa ••1234", "PayPal"). */
export const paymentMethods = sqliteTable("payment_methods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

/**
 * The core record. We deliberately do NOT store `next_payment` — it is computed
 * from `startDate` + `billingCycle` + `billingInterval` on read, so it can never
 * drift out of sync (unlike Wallos, which mutates it nightly via cron).
 *
 * Dates are stored as ISO strings ("YYYY-MM-DD") for portability with date-fns.
 */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    logoUrl: text("logo_url"),
    url: text("url"),
    price: real("price").notNull(),
    currencyCode: text("currency_code").notNull().default("GBP"),
    // 'day' | 'week' | 'month' | 'year'
    billingCycle: text("billing_cycle").notNull().default("month"),
    // "every N cycles" — e.g. cycle=month, interval=3 => quarterly
    billingInterval: integer("billing_interval").notNull().default(1),
    // Immutable anchor date the renewal schedule is computed from.
    startDate: text("start_date").notNull(),
    // Optional free-trial end date.
    trialEndDate: text("trial_end_date"),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    contextId: integer("context_id").references(() => contexts.id, {
      onDelete: "set null",
    }),
    paymentMethodId: integer("payment_method_id").references(
      () => paymentMethods.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    notify: integer("notify", { mode: "boolean" }).notNull().default(true),
    // On a free tier: no billing at all. Price is 0, and it's excluded from
    // spend totals, renewals, the calendar and reminders — tracked for awareness.
    free: integer("free", { mode: "boolean" }).notNull().default(false),
    // Prepaid/credit mode: a one-off pack you buy up front and top up, not a
    // recurring bill. Excluded from renewal math and the normalized dashboard
    // total; its charges are recorded manually (one per top-up), not computed.
    prepaid: integer("prepaid", { mode: "boolean" }).notNull().default(false),
    // Optional "runs out around" estimate for a prepaid sub — drives the top-up
    // reminder. Null means no estimate (and no reminder).
    depletesOn: text("depletes_on"),
    // Cancelled but still usable until `endsOn`. Renewals stop, but the sub stays
    // active (and counted) until that date, after which it reads as inactive.
    // `endsOn` is the ISO date access ends (the end of the last paid period).
    cancelled: integer("cancelled", { mode: "boolean" }).notNull().default(false),
    endsOn: text("ends_on"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => [
    index("idx_subscriptions_active").on(t.active),
    index("idx_subscriptions_category").on(t.categoryId),
    index("idx_subscriptions_context").on(t.contextId),
  ],
);

/** Key/value application settings (base currency, ntfy config, theme, etc.). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

/**
 * Cached FX rates, refreshed daily from the Frankfurter API.
 * `rateToBase` converts 1 unit of `code` into the configured base currency.
 */
export const fxRates = sqliteTable("fx_rates", {
  code: text("code").primaryKey(),
  rateToBase: real("rate_to_base").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

/**
 * A ledger of actual past billing occurrences — one row per charge that has come
 * due. Immutable historical facts: the amount and the FX rate are snapshotted at
 * charge time and never rewritten. Future occurrences are NOT stored here; they
 * stay computed on read from the subscription's schedule, so nothing drifts.
 */
export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    // ISO "YYYY-MM-DD" — the date this charge fell due.
    paidOn: text("paid_on").notNull(),
    // Native amount and currency at charge time.
    amount: real("amount").notNull(),
    currencyCode: text("currency_code").notNull(),
    // Amount converted into the base currency using the rate on `paidOn`.
    amountBase: real("amount_base").notNull(),
    baseCurrency: text("base_currency").notNull(),
    // The native->base rate used (1 when native == base), kept for transparency.
    fxRate: real("fx_rate").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => [
    index("idx_payments_subscription").on(t.subscriptionId),
    index("idx_payments_paid_on").on(t.paidOn),
    // One charge per subscription per date — makes backfill/append idempotent.
    uniqueIndex("uniq_payments_sub_date").on(t.subscriptionId, t.paidOn),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Context = typeof contexts.$inferSelect;
export type NewContext = typeof contexts.$inferInsert;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
