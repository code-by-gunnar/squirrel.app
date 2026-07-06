# Reports: current-month fix + monthly drill-down — Design

**Date:** 2026-07-06
**Status:** Approved, ready for planning
**Target version:** v1.11.0

## Problem

Two linked issues in the Reports monthly-spend chart:

1. **The current month under-reports (a "dead zone").** `getMonthlySpend`
   (`src/lib/reports.ts`) builds the chart from the `payments` ledger for past +
   current months, and a schedule projection for future months that **starts at
   next month** (`rangeStart = thisMonth + 1`). So a charge due **later this
   month** (e.g. an annual sub renewing July 20 when today is July 6) is in
   neither the recorded current-month bar nor the projection — it's counted
   nowhere. The current month therefore shows only what's been billed up to today,
   and a near-term annual renewal can be invisible on the chart entirely.
   A contributing display effect: a projected month with no scheduled renewal has
   `total: 0` and renders as an invisible zero-height bar.

2. **No visibility into which subs make up a month.** The report shows only the
   monthly total. Clicking a month gives no breakdown of the subscriptions behind
   it.

The daily job (`runDailyPayments`) is working correctly — this is not missing
data, it's that the report never projects the *remainder of the current month*.

## Decisions

- **Every month is a split of `recorded` (fact) + `forecast` (schedule).** The
  projection window changes from "starts next month" to "starts today," so the
  current month's remaining charges are forecast and counted.
- **Current-month bar = recorded so far + projected remainder**, visually
  distinguished (chosen over "full normalized month" and "actual-so-far + separate
  upcoming").
- **Per-sub line items** are computed for every month, powering a **drill-down**:
  clicking a month lists its subscriptions.
- **Drill-down rows:** logo + name + amount + charged/scheduled date, with
  billed vs forecast marking, and a month total (chosen over name+amount-only and
  full-detail-with-category+context).
- `getSpendTotals` (all-time / this-year) is unchanged — actual-cashflow figures,
  correct as-is.

## Data model

`getMonthlySpend(filter, months?, projectedMonths?, now?)` returns a richer shape (the new `now` param is appended last so the existing `months`/`projectedMonths` positions are unchanged; the only caller, `reports/page.tsx`, passes just `filter`):

```ts
type MonthEntry = {
  subId: number;
  name: string;
  logoUrl: string | null;
  categoryColor: string | null;
  amount: number;      // base currency
  date: string;        // ISO — charged date (billed) or scheduled date (forecast)
  kind: "billed" | "forecast";
};

type MonthlySpend = {
  month: string;       // "YYYY-MM"
  label: string;       // "Jul 26"
  recorded: number;    // Σ billed items (facts from the ledger)
  forecast: number;    // Σ forecast items (scheduled, not yet charged)
  total: number;       // recorded + forecast
  items: MonthEntry[]; // sorted by date
};
```

How each month is built:
- **Past months** — all `billed`, from the `payments` ledger joined to
  `subscriptions` (name / logoUrl / categoryColor). `forecast = 0`,
  `total = recorded`.
- **Current month** — `billed` items (ledger charges with `paidOn <= today`)
  **plus** `forecast` items: each active recurring sub's scheduled renewals in
  `[today, monthEnd]`, **minus any `(subId, date)` already present as a billed
  item** (so a charge due today that's already recorded isn't double-counted, and
  one due today not yet recorded still shows as forecast).
- **Future months** — all `forecast`: each active sub's scheduled renewals in that
  month.

Forecast amount per item is the sub's `priceBase` (base-converted at today's rate);
billed amount is the ledger's `amountBase` (historical FX snapshot) — consistent
with current behaviour. Forecast excludes free / prepaid / cancelled subs (already
the case); prepaid top-ups appear as `billed` items via the ledger.

**Testability:** add an optional trailing `now: Date = new Date()` parameter,
threaded through all the month math, so "current month" is deterministic in tests
(mirrors `billing.ts` helpers that take a `from` date). Zero production behaviour
change.

## Chart (stacked recorded/forecast)

`MonthlySpendChart` becomes a **stacked bar** with two series:
- `recorded` — solid, primary colour.
- `forecast` — same colour at ~35% opacity, stacked on top of `recorded`.

This renders every case correctly with one uniform treatment:
- Past months → all solid (fact).
- Current month → solid base (billed) + faded cap (still-to-come) — the split is
  obvious.
- Future months → all faded (forecast).

A small **"Billed / Forecast"** legend explains the two shades. The tooltip shows
billed + forecast + total for the hovered month. Zero-renewal months stay
zero-height (genuinely nothing due); this-month's upcoming charges are no longer
hidden because they live in the current bar's forecast cap.

## Drill-down panel

- Wrap the chart + panel in one **client component** (`MonthlyReport`) that
  receives `MonthlySpend[]` and owns `selectedMonth` state. `getMonthlySpend`
  computes every month's `items` server-side, so clicking is instant (no
  round-trips).
- Clicking/tapping any bar selects that month; the selected bar gets a subtle
  highlight. **Default selection = current month.**
- The panel sits directly below the chart in the Reports card. Header:
  `July 2026 · £48.20`, with a `£12.99 billed · £35.21 forecast` sub-line when the
  month is split. Then the `items` list — each row: logo, name, amount, and the
  charged/scheduled date. **Billed** rows render normally; **forecast** rows are
  subtly de-emphasised (a "forecast" tag / lighter text). Rows sorted by date.
- Empty month reads "Nothing that month."
- Mobile: tap a bar; the panel stacks below.

## Edge cases

- **No double-count at "today"**: forecast = renewals in
  `[max(today, monthStart), monthEnd]` minus `(subId, date)` already billed that
  month.
- **Daily/weekly subs** produce multiple billed + forecast rows in a month (each
  occurrence its own row) — correct.
- **Deleted subs** never orphan billed items (payments cascade-delete with the
  sub), so every billed row joins to a live sub.
- **Cancelled** subs excluded from forecast, still shown as billed rows for
  earlier-in-month charges.
- **Context filter** scopes both halves (billed via `subscriptionIdsForContext`,
  forecast via `listSubscriptions(filter)`).
- **Timezone**: "today" / month boundaries from server local time (`now`),
  consistent with the rest of the app.

## Testing (Vitest, temp-DB harness)

- Past month: items from the ledger as `billed`; `recorded === total`,
  `forecast === 0`.
- **Original bug:** an annual sub due later in the current month appears in the
  current month's `forecast`, and is not double-counted anywhere.
- Current month: `billed` (≤ today) + `forecast` (> today) with no `(subId, date)`
  double-count; `recorded + forecast === total`.
- Future month: all `forecast`, `recorded === 0`.
- Context filter scopes both halves; prepaid excluded from forecast but present as
  a billed item; free/cancelled excluded from forecast.
- `now` parameter makes all of the above deterministic.

## Out of scope (YAGNI)

- No new month navigation beyond the 12 past + 3 future already shown.
- No CSV/export changes (the payments CSV already lists every charge).
- No change to `getSpendTotals` or the two stat cards.

## Affected files

- `src/lib/reports.ts` — new `MonthEntry`/`MonthlySpend` shape; `getMonthlySpend`
  builds billed + forecast items with the `now` param; forecast window starts
  today.
- `src/components/monthly-spend-chart.tsx` — stacked recorded/forecast bars +
  legend + selectable bars (likely folded into the new `MonthlyReport`).
- `src/components/monthly-report.tsx` (new) — client wrapper: chart + drill-down
  panel + `selectedMonth` state.
- `src/app/(app)/reports/page.tsx` — pass the richer data to `MonthlyReport`.
- `src/lib/reports.test.ts` (new) — the tests above.
- `package.json` / `README.md` — version bump + a short note.
