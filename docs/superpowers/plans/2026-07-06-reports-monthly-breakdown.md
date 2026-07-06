# Reports: current-month fix + monthly drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the monthly-spend report count the current month's still-to-come charges (a recorded+forecast split) and let the user click a month to see exactly which subscriptions made it up.

**Architecture:** `getMonthlySpend` is reworked to return, per month, a `recorded`/`forecast` split plus a per-sub `items` list — billed items from the `payments` ledger, forecast items from each active sub's schedule starting **today** (not next month). The chart becomes a stacked bar (billed solid + forecast faded), wrapped with a drill-down panel in a new stateful client component.

**Tech Stack:** Next.js 16 (App Router, server components), Drizzle ORM + better-sqlite3, React 19, Recharts (via shadcn chart primitives), Vitest.

## Global Constraints

- **Every month is `recorded` (billed, ledger facts) + `forecast` (scheduled, not yet charged); `total = recorded + forecast`.** Forecast excludes free / prepaid / cancelled subs; prepaid top-ups appear as `billed` items via the ledger.
- **Forecast window starts today**, not next month: renewals in `[max(today, monthStart), monthEnd]`, and any `(subId, date)` already present as a billed item that month is **skipped** (no double-count at "today").
- **`getMonthlySpend` gains a trailing `now: Date = new Date()` param** (appended last; existing `months`/`projectedMonths` positions unchanged) so "current month" is deterministic in tests. `getSpendTotals` is unchanged.
- **Money** is base-currency-converted: billed uses the ledger's `amountBase` (historical FX); forecast uses the sub's `priceBase` (today's FX). **Dates** are ISO `"YYYY-MM-DD"`.
- **Context filter** scopes both halves (billed via `subscriptionIdsForContext`; forecast via `listSubscriptions(filter)`), matching current behaviour.
- **Chart:** stacked `recorded` (solid) + `forecast` (~35% opacity) bars; bars are clickable to select a month; a "Billed / Forecast" legend explains the shades.
- No changes to `getSpendTotals`, the two stat cards, CSV/export, or month range (12 past+current, 3 future).
- Version bump `1.10.0` → `1.11.0` (final task). Commit after each task; `npm test` passes before every commit.

---

## File structure

**Modified:**
- `src/lib/reports.ts` — new `MonthEntry`/`MonthlySpend` types; `getMonthlySpend` rebuilt (billed + forecast items, `now` param).
- `src/components/monthly-spend-chart.tsx` — stacked, selectable bars.
- `src/app/(app)/reports/page.tsx` — render the new `MonthlyReport`; updated card copy.
- `package.json` / `README.md` — version + docs.

**Created:**
- `src/components/monthly-report.tsx` — client wrapper: legend + chart + drill-down panel + `selectedMonth` state.
- `src/lib/reports.test.ts` — data-layer tests.

---

## Task 1: Rework `getMonthlySpend` (data layer)

**Files:**
- Modify: `src/lib/reports.ts`
- Create: `src/lib/reports.test.ts`

**Interfaces:**
- Produces:
  - `type MonthEntry = { subId: number; name: string; logoUrl: string | null; categoryColor: string | null; amount: number; date: string; kind: "billed" | "forecast" }`
  - `type MonthlySpend = { month: string; label: string; recorded: number; forecast: number; total: number; items: MonthEntry[] }`
  - `getMonthlySpend(filter?: ContextFilter, months?: number, projectedMonths?: number, now?: Date): MonthlySpend[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports.test.ts`. COPY the temp-DB harness verbatim from `src/lib/subscriptions.test.ts` (better-sqlite3 + drizzle + `migrate` + OS-temp `DATABASE_PATH` set before a dynamic `@/db` import in `beforeAll`, clearing `globalThis.__squirrelDb` + `vi.resetModules()`, and the drizzle-internal handle close + temp-file unlink in `afterAll`). Read that file first to replicate it exactly. Seed base currency GBP. Then:

```ts
// imports after the harness: getMonthlySpend from "./reports", subscriptions/payments/categories from "@/db/schema", eq from "drizzle-orm"
const NOW = new Date(2026, 6, 6); // 2026-07-06 (month index 6 = July), local time

function addSub(over: Record<string, unknown>): number {
  return Number(
    db.insert(subscriptions).values({
      name: "X", price: 10, currencyCode: "GBP",
      billingCycle: "month", billingInterval: 1, startDate: "2020-01-01",
      ...over,
    }).run().lastInsertRowid,
  );
}
function addPayment(subId: number, paidOn: string, amountBase: number) {
  db.insert(payments).values({
    subscriptionId: subId, paidOn, amount: amountBase, currencyCode: "GBP",
    amountBase, baseCurrency: "GBP", fxRate: 1,
  }).run();
}
function month(series: MonthlySpend[], key: string) {
  return series.find((m) => m.month === key)!;
}

describe("getMonthlySpend", () => {
  it("puts a past ledger charge in its month as a billed item", () => {
    const id = addSub({ name: "Netflix" });
    addPayment(id, "2026-05-15", 9.99);
    const may = month(getMonthlySpend("all", 12, 3, NOW), "2026-05");
    expect(may.recorded).toBe(9.99);
    expect(may.forecast).toBe(0);
    expect(may.total).toBe(9.99);
    expect(may.items).toHaveLength(1);
    expect(may.items[0]).toMatchObject({ name: "Netflix", kind: "billed", amount: 9.99, date: "2026-05-15" });
  });

  it("forecasts an annual sub due later THIS month (the dead-zone bug)", () => {
    // yearly sub whose next renewal on/after 2026-07-06 is 2026-07-20
    const id = addSub({ name: "Annual", price: 120, billingCycle: "year", startDate: "2020-07-20" });
    const series = getMonthlySpend("all", 12, 3, NOW);
    const jul = month(series, "2026-07");
    const forecastItem = jul.items.find((i) => i.name === "Annual");
    expect(forecastItem).toMatchObject({ kind: "forecast", date: "2026-07-20" });
    expect(jul.forecast).toBeCloseTo(120, 2);
    // and it appears in no other month within the window
    const others = series.filter((m) => m.month !== "2026-07");
    expect(others.some((m) => m.items.some((i) => i.name === "Annual"))).toBe(false);
  });

  it("does not double-count a charge due today that is already recorded", () => {
    // monthly sub renewing on the 6th; today is the 6th; the July-6 charge is recorded
    const id = addSub({ name: "Spotify", billingCycle: "month", startDate: "2026-06-06" });
    addPayment(id, "2026-07-06", 10);
    const jul = month(getMonthlySpend("all", 12, 3, NOW), "2026-07");
    const spotifyRows = jul.items.filter((i) => i.name === "Spotify");
    expect(spotifyRows).toHaveLength(1);          // billed only, no forecast dupe
    expect(spotifyRows[0].kind).toBe("billed");
    expect(jul.recorded + jul.forecast).toBeCloseTo(jul.total, 2);
  });

  it("makes a future month all forecast", () => {
    addSub({ name: "Monthly", billingCycle: "month", startDate: "2026-01-10" });
    const aug = month(getMonthlySpend("all", 12, 3, NOW), "2026-08");
    expect(aug.recorded).toBe(0);
    expect(aug.items.every((i) => i.kind === "forecast")).toBe(true);
    expect(aug.items.some((i) => i.name === "Monthly" && i.date === "2026-08-10")).toBe(true);
  });

  it("excludes free/prepaid/cancelled from the forecast", () => {
    addSub({ name: "Free", free: true, billingCycle: "month", startDate: "2026-01-15" });
    addSub({ name: "Prepaid", prepaid: true, billingCycle: "month", startDate: "2026-01-15" });
    addSub({ name: "Cancelled", cancelled: true, endsOn: "2026-06-01", billingCycle: "month", startDate: "2026-01-15" });
    const aug = month(getMonthlySpend("all", 12, 3, NOW), "2026-08");
    expect(aug.items.some((i) => ["Free", "Prepaid", "Cancelled"].includes(i.name))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/reports.test.ts`
Expected: FAIL — `MonthlySpend` has no `recorded`/`items`, `getMonthlySpend` ignores `now`, and the current month has no forecast.

- [ ] **Step 3: Rewrite `getMonthlySpend`**

Replace the top imports and the `MonthlySpend` type + `getMonthlySpend` function in `src/lib/reports.ts` (leave `getSpendTotals` untouched). New imports:

```ts
import "server-only";
import { db } from "@/db";
import { payments, subscriptions, categories } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";
import { listSubscriptions } from "@/lib/subscriptions";
import { renewalsInRange, toISODate, type BillingCycle } from "@/lib/billing";
import { subscriptionIdsForContext, type ContextFilter } from "@/lib/contexts";
```

Types (replace the old `MonthlySpend`):

```ts
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
```

Keep `round2`, `monthKey`, `monthLabel` as-is. Replace the function:

```ts
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
```

> The assembly loop runs `i` from `months-1` (oldest) down to `-projectedMonths` (furthest future), so past, current, and future months come from one uniform pass — the current month naturally gets both its billed and forecast items.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/reports.test.ts` → PASS (5 tests).
Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS (96 + 5 new; note `getSpendTotals` tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.ts src/lib/reports.test.ts
git commit -m "feat(reports): recorded+forecast month split with per-sub items"
```

---

## Task 2: Stacked chart + drill-down panel + page wiring

**Files:**
- Modify: `src/components/monthly-spend-chart.tsx`
- Create: `src/components/monthly-report.tsx`
- Modify: `src/app/(app)/reports/page.tsx`

**Interfaces:**
- Consumes: `MonthlySpend`/`MonthEntry` (Task 1).
- Produces: `MonthlySpendChart` (presentational, selectable) + `MonthlyReport` (stateful wrapper).

- [ ] **Step 1: Rework `MonthlySpendChart` into stacked, selectable bars**

Replace `src/components/monthly-spend-chart.tsx` entirely:

```tsx
"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import type { MonthlySpend } from "@/lib/reports";
import { formatCurrency, currencySymbol } from "@/lib/currency";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type Props = {
  data: MonthlySpend[];
  baseCurrency: string;
  selectedMonth: string | null;
  onSelectMonth: (month: string) => void;
};

const config: ChartConfig = {
  recorded: { label: "Billed", color: "var(--primary)" },
  forecast: { label: "Forecast", color: "var(--primary)" },
};

export function MonthlySpendChart({ data, baseCurrency, selectedMonth, onSelectMonth }: Props) {
  if (!data.some((d) => d.total > 0)) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No spending recorded yet. Charges appear here as your subscriptions renew.
      </div>
    );
  }

  const symbol = currencySymbol(baseCurrency).trim();
  const dim = (month: string) => (selectedMonth === null || selectedMonth === month ? 1 : 0.5);

  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart
        data={data}
        margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
        onClick={(state) => {
          const key = (state?.activePayload?.[0]?.payload as MonthlySpend | undefined)?.month;
          if (key) onSelectMonth(key);
        }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={52} fontSize={12} tickFormatter={(v) => `${symbol}${Math.round(Number(v))}`} />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value), baseCurrency)} />}
        />
        <Bar dataKey="recorded" stackId="a" fill="var(--color-recorded)">
          {data.map((d) => (
            <Cell key={d.month} cursor="pointer" fillOpacity={dim(d.month)} />
          ))}
        </Bar>
        <Bar dataKey="forecast" stackId="a" fill="var(--color-forecast)" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.month} cursor="pointer" fillOpacity={0.35 * dim(d.month)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
```

> Stacked-bar note: past (fully-billed) months render with a flat top (the `recorded` bar carries no top radius); this is an acceptable minor aesthetic of the stack. Selecting a month dims the others to 0.5.

- [ ] **Step 2: Create `MonthlyReport` (state + legend + panel)**

Create `src/components/monthly-report.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { MonthlySpend } from "@/lib/reports";
import { formatCurrency } from "@/lib/currency";
import { MonthlySpendChart } from "@/components/monthly-spend-chart";
import { SubscriptionLogo } from "@/components/subscription-logo";
import { cn } from "@/lib/utils";

/** The client's current-month key (matches the server's within a day; guarded by a fallback). */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthlyReport({
  data,
  baseCurrency,
}: {
  data: MonthlySpend[];
  baseCurrency: string;
}) {
  const fallback = data[data.length - 1]?.month ?? null;
  const initial = data.some((m) => m.month === currentMonthKey())
    ? currentMonthKey()
    : fallback;
  const [selectedMonth, setSelectedMonth] = useState<string | null>(initial);

  const selected = data.find((m) => m.month === selectedMonth) ?? null;

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: "var(--primary)" }} />
          Billed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: "var(--primary)", opacity: 0.35 }} />
          Forecast
        </span>
      </div>

      <MonthlySpendChart
        data={data}
        baseCurrency={baseCurrency}
        selectedMonth={selectedMonth}
        onSelectMonth={setSelectedMonth}
      />

      {/* Drill-down panel */}
      {selected ? (
        <div className="border-t pt-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <p className="text-sm font-semibold">{monthTitle(selected.month)}</p>
              {selected.recorded > 0 && selected.forecast > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(selected.recorded, baseCurrency)} billed ·{" "}
                  {formatCurrency(selected.forecast, baseCurrency)} forecast
                </p>
              ) : null}
            </div>
            <p className="text-sm font-semibold">{formatCurrency(selected.total, baseCurrency)}</p>
          </div>

          {selected.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing that month.</p>
          ) : (
            <ul className="divide-y">
              {selected.items.map((it, i) => (
                <li
                  key={`${it.subId}-${it.date}-${i}`}
                  className={cn(
                    "flex items-center justify-between py-2.5",
                    it.kind === "forecast" && "text-muted-foreground",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <SubscriptionLogo name={it.name} logoUrl={it.logoUrl} color={it.categoryColor} />
                    <div>
                      <p className="text-sm font-medium text-foreground">{it.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.date}
                        {it.kind === "forecast" ? " · forecast" : ""}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-medium">{formatCurrency(it.amount, baseCurrency)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function monthTitle(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}
```

- [ ] **Step 3: Wire into the Reports page**

In `src/app/(app)/reports/page.tsx`: swap the import and the render, and update the card copy.

Change the import (line 6):

```tsx
import { MonthlyReport } from "@/components/monthly-report";
```

Replace the "Monthly spend" `Card` body (lines 73-84) so the description and component match:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Monthly spend</CardTitle>
          <CardDescription>
            Per month in {base} — solid is billed, faded is forecast from your
            renewal schedule. Click a month to see the subscriptions behind it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyReport data={monthly} baseCurrency={base} />
        </CardContent>
      </Card>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → succeeds.
Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/monthly-spend-chart.tsx src/components/monthly-report.tsx "src/app/(app)/reports/page.tsx"
git commit -m "feat(reports): stacked billed/forecast chart + month drill-down"
```

---

## Task 3: Version bump + docs

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Bump version**

`package.json`: `"version": "1.10.0"` → `"version": "1.11.0"`.

- [ ] **Step 2: README**

Update the existing **Reports** bullet in the `## Features` list to mention the new behaviour concisely, in the README's shipped-reality voice: the monthly chart now splits each month into **billed** (actual charges) and **forecast** (scheduled, including the rest of the current month), and you can **click a month to see which subscriptions made it up**. Read the current Reports bullet first and edit it in place rather than adding a duplicate.

- [ ] **Step 3: Final verification**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore: v1.11.0 — reports current-month fix + drill-down"
```

- [ ] **Step 5: Release (after merge to main — per AGENTS.md)**

> Not run inside the worktree branch. After merge to `main`: bump is done; `git tag -a v1.11.0 -m "v1.11.0"` + push (triggers GHCR build); `gh release create v1.11.0 --verify-tag --title "v1.11.0" --notes "..." --latest`.

---

## Manual smoke test (after Task 2, before release)

`npm run dev` → Reports:
1. The current month's bar shows a solid base (billed) + a faded cap (forecast) if anything renews later this month.
2. An **annual** sub due later this month now appears (faded) in the current month — previously invisible.
3. Click any bar → the panel below lists that month's subs (logo, name, date, amount); forecast rows are de-emphasised with a "forecast" note; the header shows the total (and a `£X billed · £Y forecast` sub-line when split). Default selection is the current month.
4. A future month with no renewals shows an empty panel ("Nothing that month") and a zero-height bar.
5. Switch the header **context** to Work → both the bars and the drill-down re-scope.

---

## Self-review

**Spec coverage:** recorded+forecast split & forecast-from-today (Task 1); per-sub items & dedup-at-today & `now` param (Task 1); stacked selectable chart + legend (Task 2); drill-down panel with logo/name/amount/date + billed/forecast marking + total + billed/forecast sub-line (Task 2); default current month (Task 2); page wiring + copy (Task 2); version + docs (Task 3). Edge cases (deleted subs via innerJoin, cancelled excluded from forecast, context scoping, prepaid billed-only) covered in Task 1 code + tests. ✅

**Placeholder scan:** no TBD/"handle edge cases"/"similar to Task N" — all code written out. ✅

**Type consistency:** `MonthEntry`/`MonthlySpend` field names (`recorded`/`forecast`/`total`/`items`; `subId`/`name`/`logoUrl`/`categoryColor`/`amount`/`date`/`kind`) identical across Task 1 (definition + query) and Task 2 (chart `dataKey="recorded"`/`"forecast"`, panel `it.subId`/`it.name`/`it.logoUrl`/`it.categoryColor`/`it.amount`/`it.date`/`it.kind`). `getMonthlySpend(filter, months, projectedMonths, now)` signature consistent (Task 1 def + test calls). Chart props `selectedMonth`/`onSelectMonth` consistent between the two components. ✅

**Known verification note for implementers:** the temp-DB harness (Task 1) must be copied from `src/lib/subscriptions.test.ts` (it already solves `server-only`-under-Vitest via the `vitest.config.ts` stub and the `globalThis.__squirrelDb` reset for a fresh DB). Confirm that file's harness before writing Task 1's test.
