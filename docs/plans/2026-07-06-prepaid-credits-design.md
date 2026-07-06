# Prepaid / Credit-based Subscriptions — Design

**Date:** 2026-07-06
**Status:** Approved, ready for implementation
**Target version:** v1.10.0

## Problem

Some subscriptions aren't recurring: you buy a pack of credits up front (e.g. API
credits, prepaid balances), draw it down, and top up when it runs out — on no
fixed cadence. Squirrel's entire model assumes recurring billing with a computed
renewal date, so these don't fit. We want to track the **spend** honestly and get
a **nudge to top up**, without any usage-metering or API integration.

## Decisions

- **Prepaid is a non-recurring billing mode**, not a new cycle length. It mirrors
  how `free` works: a flag on the subscription.
- **Spend + top-up nudge** (not balance tracking). No credit-remaining math, no
  per-use bookkeeping — the user explicitly does not want usage/API metering.
- **One living entry, topped up over time.** A single "OpenAI credits" entry; a
  **Top up** action records each purchase. The list stays clean.
- **Charges live in the ledger.** Each purchase/top-up writes a real `payments`
  row (amount + FX snapshot). This is the source of truth for spend and history.
  The key flip vs. recurring subs: recurring charges are *computed from a
  schedule*; prepaid charges are *manually recorded* from top-up events.
- **Excluded from the dashboard's normalized figure.** A prepaid purchase is a
  one-off cash event belonging to the month it was paid — amortizing it would skew
  the true monthly recurring spend. Burn a pack and rebuy the same month → both
  charges land in that month (via Reports). So prepaid subs are excluded from the
  normalized monthly/yearly total (like `free`), but **counted in Reports** (real
  cashflow).
- **Optional "runs out around" date** (`depletesOn`) drives the reminder.

## Data model

Two new columns on `subscriptions` (mirroring `free`):

- `prepaid` — `integer` boolean, `NOT NULL DEFAULT false`.
- `depletesOn` — nullable ISO `"YYYY-MM-DD"` date (the "runs out around" estimate).

Reused columns for a prepaid sub:
- `price` — the last top-up amount (denormalized convenience: the Top-up prefill
  default and card figure; kept in sync with the latest ledger charge).
- `startDate` — first purchase date.
- `currencyCode`, `categoryId`, `contextId`, `notes`, `active`, `notify` — all apply.
- `billingCycle` / `billingInterval` — ignored for prepaid (left at defaults, never read).

## Form, create/edit split & Top up

**Billing-type selector** in the add/edit sheet: **Recurring** (default) /
**Prepaid credits** / **Free** — mutually exclusive; replaces the standalone
"Free plan" switch. Choosing **Prepaid credits**:
- hides cycle/interval,
- relabels `price` → "Amount paid" and `startDate` → "Purchase date",
- shows an optional "Runs out around" date (`depletesOn`).

**Create vs edit split** (keeps save paths clean, like contexts):
- **Create** a prepaid sub → records its first purchase as a ledger charge (amount
  + FX at the purchase date).
- **Edit** an existing prepaid sub → updates metadata only (name, default amount,
  `depletesOn`, context…). Never silently adds a charge.

**Top up** — a card dropdown item, shown only for prepaid subs. Dialog: **amount**
(prefilled with last top-up), **date** (default today), **runs out around** date.
Confirm →
- appends a `payments` row (FX for that day),
- updates the sub's stored amount + `depletesOn`.
- **Same-day top-up sums** into that day's existing charge (preserves the ledger's
  one-row-per-sub-per-date unique index; monthly totals stay correct).

**Card.** Prepaid card reads e.g. **"£50 credits · topped up 3 Jun · runs out ~in
20d"** with a **Prepaid** badge. Once `depletesOn` passes without a top-up it styles
like expired — **"ran out ~14 Jun"** — a nudge, not an auto-deactivation.

## Reminders

Driven by `depletesOn` instead of a renewal date. If `notify` is on and
`depletesOn` is set, a top-up reminder fires on the same lead-day / day-of schedule,
worded *"{name} credits run out around {date} — top up soon,"* fanned out to the
configured channels. Because the date is an estimate it won't nag forever: fires in
the lead window and on the day, one nudge if it slips past, then quiet until the
next top-up resets `depletesOn`.

## Reports, Dashboard, Calendar

- **Reports** (`reports.ts`): past spend reads from the ledger → prepaid top-ups
  count automatically as real spikes. The future *projection* is schedule-based, so
  prepaid subs are excluded from it (no schedule).
- **Dashboard** (`stats.ts`): prepaid excluded from the normalized monthly/yearly
  total, category breakdown, and "upcoming renewals". Still counted in the
  active-subscription **count**.
- **Calendar**: no recurring markers. A single distinctly-styled **"{name} runs out
  ~"** marker is placed on `depletesOn` (approved — included).

## Migration

`drizzle/0005_*.sql` (generated from schema): `ALTER TABLE subscriptions ADD
prepaid integer NOT NULL DEFAULT false`; `ADD depletes_on text`. No seed. Existing
subs default to `prepaid = false` — no behaviour change.

## Edge cases

- **Backfill/rebuild skip prepaid** (`payments.ts` `backfillPayments` /
  `rebuildPaymentsForSub` early-return when `prepaid`) — charges only ever come from
  Top up. `saveSubscription` skips backfill/rebuild for prepaid; on create it calls
  the new manual-charge helper instead.
- **New helper** `recordTopUp(subId, paidOn, amount, currencyCode)` in `payments.ts`:
  fetches the FX rate for `paidOn`, inserts (or sums, on same-date collision) a
  `payments` row. Reuses the existing FX-snapshot logic from backfill.
- **Switching type on edit** (recurring ↔ prepaid): allowed. Past recurring charges
  remain as real history; we never auto-invent prepaid charges. Recurring stays
  schedule-driven, prepaid stays manual.
- **`depletesOn` in the past** at creation (logging an old pack): card shows "ran
  out ~date", no future reminder. Fine.
- **No `depletesOn`**: no reminder; card shows "topped up {date}" with no countdown.
- **Backup** round-trips `prepaid` + `depletesOn` (charges are already covered by the
  `payments` backup).
- **Delete** a prepaid sub → its ledger charges cascade-delete (existing FK).

## Testing (Vitest)

- `recordTopUp`: inserts a charge with correct FX; same-date top-up sums; prepaid
  create records the first charge.
- Prepaid excluded from `computeDashboardStats` normalized totals + upcoming;
  included in active count.
- Prepaid excluded from `getMonthlySpend` projection; its ledger charges included in
  past months + `getSpendTotals`.
- `backfillPayments` / `rebuildPaymentsForSub` no-op for prepaid.
- Reminder logic: fires within lead window of `depletesOn`; quiet after the overdue
  nudge; no reminder when `depletesOn` is null.
- Enriched fields: `daysUntilDepletion` / depleted status derived correctly.

## Out of scope (YAGNI)

- Usage / API-metered tracking (explicitly rejected).
- Credit-balance remaining + decrement UI.
- CSV **import** of prepaid subs (backup round-trip is enough for now; revisit if
  needed). CSV **export** may include the columns for completeness.

## Affected files

- `src/db/schema.ts` — `prepaid`, `depletesOn` columns.
- `drizzle/0005_*.sql` — migration.
- `src/lib/billing.ts` — helpers for depletion countdown (reuse `daysUntilDate`).
- `src/lib/payments.ts` — `recordTopUp`; guard `backfillPayments`/`rebuildPaymentsForSub`.
- `src/lib/subscriptions.ts` — enriched prepaid fields (`daysUntilDepletion`,
  depleted status); exclude from any recurring-only derivation.
- `src/lib/stats.ts` — exclude prepaid from normalized totals/category/upcoming.
- `src/lib/reports.ts` — exclude prepaid from the projection.
- `src/lib/reminders.ts` — `depletesOn`-driven top-up reminders.
- `src/lib/notify/payloads.ts` — top-up reminder payload wording.
- `src/app/(app)/subscriptions/actions.ts` — prepaid save path + `topUp` action.
- `src/components/subscription-sheet.tsx` — billing-type selector + prepaid fields.
- `src/components/subscriptions-view.tsx` — prepaid card + Top-up dialog/menu.
- `src/components/calendar-view.tsx` — single `depletesOn` marker.
- `src/lib/backup.ts`, `src/lib/export.ts` — round-trip prepaid/`depletesOn`.
- Tests alongside each.
