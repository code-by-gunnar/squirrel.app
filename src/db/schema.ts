import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  real,
  index,
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
    paymentMethodId: integer("payment_method_id").references(
      () => paymentMethods.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    notify: integer("notify", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => [
    index("idx_subscriptions_active").on(t.active),
    index("idx_subscriptions_category").on(t.categoryId),
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

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
