# Prepaid / Credit-based Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-recurring "prepaid credits" subscription mode — buy a pack, record each top-up as a real ledger charge, and get a top-up reminder from an optional "runs out around" date — without usage metering.

**Architecture:** `prepaid` is a flag on `subscriptions` (mirrors `free`), plus a nullable `depletesOn` date. Prepaid subs are excluded from all schedule-derived behaviour (renewal computation, backfill, dashboard normalization, reports projection, recurring reminders) and instead have **manually recorded** ledger charges (one per top-up) and a `depletesOn`-driven reminder. Charges flow through the existing `payments` ledger, so Reports counts them as real cashflow automatically.

**Tech Stack:** Next.js 16 (App Router, server components + server actions), Drizzle ORM + better-sqlite3, Zod, React 19, Base-UI-backed shadcn, Vitest.

## Global Constraints

- **`prepaid` and `free` are mutually exclusive**, and both exclude the sub from recurring math. A prepaid sub has `prepaid = true`, `free = false`, and its `billingCycle`/`billingInterval` are ignored (left at defaults, never read).
- **Charges only ever come from Top up.** `backfillPayments` and `runDailyPayments` MUST skip prepaid subs. `saveSubscription` must not backfill/rebuild a prepaid sub. Creating a prepaid sub records its first charge via `recordTopUp`; editing one never adds a charge.
- **Excluded from the dashboard's normalized figure and reports projection**, like `free`. Included in Reports' actual charges (they're in the ledger) and in the active-subscription **count**.
- **Ledger unique index** is `(subscription_id, paid_on)`. A same-day top-up must **sum** into that day's row, not error or no-op.
- **shadcn is Base UI here** — `Select` uses `render`/`items`; `onValueChange` may fire `null` (coalesce). Mirror existing Select usage in `subscription-sheet.tsx`.
- **Form null fields:** conditionally-rendered inputs submit as `null`; use `.nullish()` / the existing `optionalString`/`optionalId` helpers in the save schema. `depletesOn` follows the exact pattern of the existing `endsOn` field (`.nullish()` + ISO-regex transform).
- **Money** in `EnrichedSubscription` is base-currency-converted. **Dates** are ISO `"YYYY-MM-DD"`.
- Version bump `1.9.0` → `1.10.0` (final task only). Commit after each task; `npm test` must pass before every commit.

---

## File structure

**Modified:**
- `src/db/schema.ts` — `prepaid`, `depletesOn` columns.
- `src/lib/payments.ts` — `recordTopUp`; guard `backfillPayments`/`runDailyPayments` against prepaid.
- `src/lib/subscriptions.ts` — enriched `daysUntilDepletion`/`depleted`; zero `monthlyBase`/`yearlyBase` for prepaid.
- `src/lib/stats.ts` — exclude prepaid from normalized totals, category, upcoming; keep in count.
- `src/lib/reports.ts` — exclude prepaid from the projection.
- `src/lib/reminders.ts` — split reminder selection into a pure helper; add `depletesOn`-driven top-up reminders.
- `src/app/(app)/subscriptions/actions.ts` — prepaid save path + `topUp` action.
- `src/components/subscription-sheet.tsx` — billing-type selector + prepaid fields.
- `src/components/subscriptions-view.tsx` — prepaid card + Top-up dialog/menu.
- `src/components/calendar-view.tsx` — `depletesOn` markers.
- `src/lib/backup.ts` — `prepaid`/`depletesOn` on `SubscriptionRow` (backwards-compatible defaults).
- `src/lib/export.ts` — prepaid columns in CSV export.
- `package.json`, `README.md` — version + docs.

**Created:**
- `drizzle/0005_*.sql` + `drizzle/meta/*` — generated migration.
- `src/lib/reminders-select.ts` — pure `selectReminders(subs, lead)` (testable without DB).
- `src/lib/reminders-select.test.ts`.
- Test additions in `src/lib/payments.test.ts` (new), `src/lib/subscriptions.test.ts`, `src/lib/stats.test.ts` (new), `src/lib/backup.test.ts`.

---

## Task 1: Schema & migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0005_*.sql` (generated)

**Interfaces:**
- Produces: `subscriptions.prepaid: boolean` (NOT NULL default false); `subscriptions.depletesOn: string | null`.

- [ ] **Step 1: Add the two columns**

In `src/db/schema.ts`, in the `subscriptions` table, add both fields immediately after the `free` column (which reads `free: integer("free", { mode: "boolean" }).notNull().default(false),`):

```ts
    // Prepaid/credit mode: a one-off pack you buy up front and top up, not a
    // recurring bill. Excluded from renewal math and the normalized dashboard
    // total; its charges are recorded manually (one per top-up), not computed.
    prepaid: integer("prepaid", { mode: "boolean" }).notNull().default(false),
    // Optional "runs out around" estimate for a prepaid sub — drives the top-up
    // reminder. Null means no estimate (and no reminder).
    depletesOn: text("depletes_on"),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0005_*.sql` containing (SQLite emits ADD COLUMN):

```sql
ALTER TABLE `subscriptions` ADD `prepaid` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `depletes_on` text;
```

plus an updated `drizzle/meta/_journal.json` and snapshot. Open the `.sql` and confirm it's only those two ALTERs (no other churn).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS (86 tests, no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add prepaid + depletes_on columns to subscriptions"
```

---

## Task 2: Ledger — recordTopUp + prepaid guards

**Files:**
- Modify: `src/lib/payments.ts`
- Create: `src/lib/payments.test.ts`

**Interfaces:**
- Consumes: `prepaid` column (Task 1).
- Produces: `recordTopUp(subId: number, paidOn: string, amount: number, currencyCode: string): Promise<void>` — inserts (or sums, on same-date collision) a `payments` row with the FX rate for `paidOn`.
- `backfillPayments` and `runDailyPayments` become no-ops for prepaid subs.

- [ ] **Step 1: Write the failing test**

Create `src/lib/payments.test.ts`. It uses a real temp SQLite DB. Follow the exact temp-DB setup used in `src/lib/subscriptions.test.ts` (better-sqlite3 + drizzle + `migrate`, an OS-temp file, and the drizzle-internal handle close in cleanup — copy that harness verbatim, including the `server-only` stub already configured in `vitest.config.ts`). The behavioural assertions:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
// ...temp-db harness identical to subscriptions.test.ts (db, migrate, seed base currency GBP)...
import { recordTopUp } from "./payments";
import { subscriptions, payments } from "@/db/schema";

describe("recordTopUp", () => {
  it("records a charge for the given date and amount (same currency => rate 1)", async () => {
    const id = Number(db.insert(subscriptions).values({
      name: "OpenAI credits", price: 50, currencyCode: "GBP",
      startDate: "2026-01-01", prepaid: true,
    }).run().lastInsertRowid);

    await recordTopUp(id, "2026-01-01", 50, "GBP");

    const rows = db.select().from(payments).where(eq(payments.subscriptionId, id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(50);
    expect(rows[0].amountBase).toBe(50);
    expect(rows[0].fxRate).toBe(1);
    expect(rows[0].paidOn).toBe("2026-01-01");
  });

  it("sums a same-day top-up into the existing charge", async () => {
    const id = Number(db.insert(subscriptions).values({
      name: "Credits", price: 20, currencyCode: "GBP",
      startDate: "2026-01-01", prepaid: true,
    }).run().lastInsertRowid);

    await recordTopUp(id, "2026-02-10", 20, "GBP");
    await recordTopUp(id, "2026-02-10", 30, "GBP");

    const rows = db.select().from(payments)
      .where(eq(payments.subscriptionId, id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(50);
    expect(rows[0].amountBase).toBe(50);
  });
});

describe("backfillPayments skips prepaid", () => {
  it("records no computed charges for a prepaid sub", async () => {
    const id = Number(db.insert(subscriptions).values({
      name: "Credits", price: 50, currencyCode: "GBP",
      startDate: "2020-01-01", billingCycle: "month", billingInterval: 1,
      prepaid: true,
    }).run().lastInsertRowid);

    await backfillPayments(id);

    const rows = db.select().from(payments).where(eq(payments.subscriptionId, id)).all();
    expect(rows).toHaveLength(0);
  });
});
```

(Import `eq` from `drizzle-orm` and `backfillPayments` from `./payments` at the top.)

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/lib/payments.test.ts`
Expected: FAIL — `recordTopUp` is not exported; the backfill-skips-prepaid test fails because backfill currently records charges for any non-free sub.

- [ ] **Step 3: Guard backfill + daily against prepaid**

In `src/lib/payments.ts`:

`backfillPayments` early-return (currently `if (!sub || sub.free) return;`):

```ts
  if (!sub || sub.free || sub.prepaid) return;
```

`runDailyPayments` per-sub skip (currently `if (!sub.active || sub.free) continue;`):

```ts
      if (!sub.active || sub.free || sub.prepaid) continue;
```

- [ ] **Step 4: Implement `recordTopUp`**

Add to `src/lib/payments.ts` (it can reuse the same FX helpers `backfillPayments` uses — `getRatesForRange`, `rateForDate`, `currentRateMap`, `getBaseCurrency`). Add `sql` to the drizzle import at the top (`import { eq, sql } from "drizzle-orm";`):

```ts
/**
 * Record a single prepaid top-up as a ledger charge on `paidOn`, snapshotting the
 * FX rate for that date. If a charge already exists for this sub on this date
 * (the unique index), the amounts are SUMMED into it — so two top-ups on the same
 * day read as one day's spend and the monthly total stays correct.
 */
export async function recordTopUp(
  subId: number,
  paidOn: string,
  amount: number,
  currencyCode: string,
): Promise<void> {
  const base = getBaseCurrency();
  const sameCurrency = currencyCode === base;

  let rate = 1;
  if (!sameCurrency) {
    const historical = await getRatesForRange(currencyCode, base, paidOn, paidOn);
    rate = rateForDate(historical, paidOn) ?? currentRateMap().get(currencyCode) ?? 1;
  }
  const amountBase = amount * rate;

  db.insert(payments)
    .values({
      subscriptionId: subId,
      paidOn,
      amount,
      currencyCode,
      amountBase,
      baseCurrency: base,
      fxRate: rate,
    })
    .onConflictDoUpdate({
      target: [payments.subscriptionId, payments.paidOn],
      set: {
        amount: sql`${payments.amount} + ${amount}`,
        amountBase: sql`${payments.amountBase} + ${amountBase}`,
      },
    })
    .run();
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run src/lib/payments.test.ts` → PASS.
Run: `npm test` → PASS (full suite, 86 + new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/payments.ts src/lib/payments.test.ts
git commit -m "feat(payments): recordTopUp with same-day summing; skip prepaid in backfill"
```

---

## Task 3: Enriched prepaid fields

**Files:**
- Modify: `src/lib/subscriptions.ts`
- Modify: `src/lib/subscriptions.test.ts`

**Interfaces:**
- Consumes: `prepaid`/`depletesOn` columns.
- Produces: `EnrichedSubscription` gains `daysUntilDepletion: number | null` and `depleted: boolean`. For prepaid subs, `monthlyBase` and `yearlyBase` are `0` (they carry no recurring cost). `prepaid` and `depletesOn` are already present via the spread of `sub`.

- [ ] **Step 1: Write the failing test**

In `src/lib/subscriptions.test.ts`, add (using the existing temp-DB harness in that file):

```ts
describe("listSubscriptions prepaid enrichment", () => {
  it("zeroes recurring cost and derives depletion for a prepaid sub", () => {
    db.insert(subscriptions).values({
      name: "OpenAI credits", price: 50, currencyCode: "GBP",
      startDate: "2026-01-01", prepaid: true, depletesOn: "2026-07-16", // 10 days out from a fixed 'today'
    }).run();

    const [s] = listSubscriptions().filter((x) => x.name === "OpenAI credits");
    expect(s.prepaid).toBe(true);
    expect(s.monthlyBase).toBe(0);
    expect(s.yearlyBase).toBe(0);
    expect(typeof s.daysUntilDepletion).toBe("number");
    expect(s.depleted).toBe(false); // depletesOn is in the future
  });

  it("marks a prepaid sub depleted once depletesOn has passed", () => {
    db.insert(subscriptions).values({
      name: "Old credits", price: 10, currencyCode: "GBP",
      startDate: "2020-01-01", prepaid: true, depletesOn: "2020-02-01",
    }).run();
    const [s] = listSubscriptions().filter((x) => x.name === "Old credits");
    expect(s.depleted).toBe(true);
    expect(s.daysUntilDepletion).toBeLessThan(0);
  });

  it("leaves daysUntilDepletion null when no depletesOn", () => {
    db.insert(subscriptions).values({
      name: "No estimate", price: 10, currencyCode: "GBP",
      startDate: "2026-01-01", prepaid: true,
    }).run();
    const [s] = listSubscriptions().filter((x) => x.name === "No estimate");
    expect(s.daysUntilDepletion).toBeNull();
    expect(s.depleted).toBe(false);
  });
});
```

> Note: this test asserts sign/nullness, not an exact day count, so it doesn't depend on the real clock.

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/lib/subscriptions.test.ts`
Expected: FAIL — `daysUntilDepletion`/`depleted` not on the result; `monthlyBase` is nonzero for the prepaid sub.

- [ ] **Step 3: Add the fields**

In `src/lib/subscriptions.ts`:

Add to the `EnrichedSubscription` type (after the existing `daysUntilEnd` field):

```ts
  daysUntilDepletion: number | null; // days until `depletesOn` for a prepaid sub (null if none/not prepaid)
  depleted: boolean; // prepaid AND depletesOn has passed
```

`daysUntilDate` is already imported from `@/lib/billing`. In the `.map(...)` body of `listSubscriptions`, compute the values and override the recurring cost for prepaid. Replace the returned object's `monthlyBase`/`yearlyBase` lines and add the two new fields. The current return computes:

```ts
      monthlyBase: convertToBase(monthlyNative, sub.currencyCode, base, rates),
      yearlyBase: convertToBase(yearlyNative, sub.currencyCode, base, rates),
```

Change those two lines to:

```ts
      // A prepaid pack has no recurring monthly cost — its spend lives in the
      // ledger as one-off charges, so it must not feed normalized totals.
      monthlyBase: sub.prepaid ? 0 : convertToBase(monthlyNative, sub.currencyCode, base, rates),
      yearlyBase: sub.prepaid ? 0 : convertToBase(yearlyNative, sub.currencyCode, base, rates),
```

And add these two fields to the same returned object (next to `daysUntilEnd`):

```ts
      daysUntilDepletion: sub.prepaid && sub.depletesOn ? daysUntilDate(sub.depletesOn, from) : null,
      depleted:
        sub.prepaid && sub.depletesOn ? daysUntilDate(sub.depletesOn, from) < 0 : false,
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/subscriptions.test.ts` → PASS.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/subscriptions.ts src/lib/subscriptions.test.ts
git commit -m "feat(subscriptions): prepaid enrichment (daysUntilDepletion, depleted, zero recurring cost)"
```

---

## Task 4: Exclude prepaid from Dashboard & Reports projection

**Files:**
- Modify: `src/lib/stats.ts`
- Modify: `src/lib/reports.ts`
- Create: `src/lib/stats.test.ts`

**Interfaces:**
- Consumes: `prepaid` on `EnrichedSubscription`, `monthlyBase === 0` for prepaid.
- Produces: prepaid excluded from `computeDashboardStats` normalized totals, `byCategory`, and `upcoming`; still counted in `activeCount`. Excluded from `getMonthlySpend`'s projection.

- [ ] **Step 1: Write the failing test**

Create `src/lib/stats.test.ts` (pure — `computeDashboardStats` takes an array, no DB). Build minimal `EnrichedSubscription`-shaped objects with a small factory:

```ts
import { describe, it, expect } from "vitest";
import { computeDashboardStats } from "./stats";
import type { EnrichedSubscription } from "./subscriptions";

function sub(over: Partial<EnrichedSubscription>): EnrichedSubscription {
  return {
    id: 1, name: "x", logoUrl: null, url: null, price: 10, currencyCode: "GBP",
    billingCycle: "month", billingInterval: 1, startDate: "2026-01-01",
    trialEndDate: null, categoryId: null, paymentMethodId: null, contextId: null,
    notes: null, active: true, notify: true, free: false, cancelled: false,
    endsOn: null, prepaid: false, depletesOn: null, createdAt: "",
    categoryName: null, categoryColor: null, contextName: null, contextColor: null,
    paymentMethodName: null, nextRenewal: "2026-02-01", daysUntil: 5,
    priceBase: 10, monthlyBase: 10, yearlyBase: 120,
    status: "active", isActive: true, daysUntilEnd: null,
    daysUntilDepletion: null, depleted: false,
    ...over,
  } as EnrichedSubscription;
}

describe("computeDashboardStats with prepaid", () => {
  it("excludes prepaid from monthly/yearly totals and upcoming, keeps it in the count", () => {
    const subs = [
      sub({ id: 1, name: "Netflix", monthlyBase: 10, yearlyBase: 120 }),
      sub({ id: 2, name: "Credits", prepaid: true, monthlyBase: 0, yearlyBase: 0, daysUntil: 3 }),
    ];
    const stats = computeDashboardStats(subs);
    expect(stats.monthlyTotal).toBe(10);       // only Netflix
    expect(stats.yearlyTotal).toBe(120);
    expect(stats.activeCount).toBe(2);          // both counted as active
    expect(stats.upcoming.map((s) => s.name)).not.toContain("Credits");
    expect(stats.byCategory.length).toBe(1);    // prepaid not in category breakdown
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/lib/stats.test.ts`
Expected: FAIL — "Credits" appears in `upcoming` (it passes the current `status === "active" && !free` filter) and possibly in `byCategory`.

- [ ] **Step 3: Exclude prepaid in stats**

In `src/lib/stats.ts`, the `paid` set drives totals/category, and `upcoming` filters separately. Update both to drop prepaid. Change:

```ts
  const paid = active.filter((s) => s.status === "active" && !s.free);
```

to:

```ts
  const paid = active.filter((s) => s.status === "active" && !s.free && !s.prepaid);
```

and change the `upcoming` filter:

```ts
  const upcoming = active
    .filter((s) => s.status === "active" && !s.free)
```

to:

```ts
  const upcoming = active
    .filter((s) => s.status === "active" && !s.free && !s.prepaid)
```

(`activeCount` stays `active.length`, so prepaid subs are still counted — no change there.)

- [ ] **Step 4: Exclude prepaid from the reports projection**

In `src/lib/reports.ts`, `getMonthlySpend`'s projection currently filters:

```ts
    const subs = listSubscriptions(filter).filter((s) => s.status === "active" && !s.free);
```

Change to:

```ts
    const subs = listSubscriptions(filter).filter(
      (s) => s.status === "active" && !s.free && !s.prepaid,
    );
```

(Past charges come from the `payments` ledger, which already includes prepaid top-ups — leave that path unchanged.)

- [ ] **Step 5: Verify**

Run: `npx vitest run src/lib/stats.test.ts` → PASS.
Run: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stats.ts src/lib/reports.ts src/lib/stats.test.ts
git commit -m "feat(stats,reports): exclude prepaid from normalized totals + projection"
```

---

## Task 5: Reminders — top-up nudges from depletesOn

**Files:**
- Create: `src/lib/reminders-select.ts`
- Create: `src/lib/reminders-select.test.ts`
- Modify: `src/lib/reminders.ts`

**Interfaces:**
- Produces: `selectReminders(subs, lead)` — a pure function returning `{ renewals: T[]; topups: T[] }` given enriched subs and the lead-days number. `runDailyReminders` uses it and sends a message covering both groups.

- [ ] **Step 1: Write the failing test**

Create `src/lib/reminders-select.test.ts` (pure, no DB):

```ts
import { describe, it, expect } from "vitest";
import { selectReminders } from "./reminders-select";

type S = Parameters<typeof selectReminders>[0][number];
function sub(over: Partial<S>): S {
  return {
    name: "x", status: "active", free: false, prepaid: false, notify: true,
    daysUntil: 99, depletesOn: null, daysUntilDepletion: null, ...over,
  } as S;
}

describe("selectReminders", () => {
  const lead = 3;

  it("picks recurring subs renewing at exactly lead or today, excluding prepaid/free", () => {
    const subs = [
      sub({ name: "A", daysUntil: 3 }),         // lead → in
      sub({ name: "B", daysUntil: 0 }),         // today → in
      sub({ name: "C", daysUntil: 5 }),         // out
      sub({ name: "D", free: true, daysUntil: 0 }),      // free → out
      sub({ name: "E", prepaid: true, daysUntil: 0 }),   // prepaid → not a renewal
    ];
    const { renewals } = selectReminders(subs, lead);
    expect(renewals.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("picks prepaid subs running out at exactly lead or today", () => {
    const subs = [
      sub({ name: "P1", prepaid: true, daysUntilDepletion: 3 }),  // lead → in
      sub({ name: "P2", prepaid: true, daysUntilDepletion: 0 }),  // today → in
      sub({ name: "P3", prepaid: true, daysUntilDepletion: 9 }),  // out
      sub({ name: "P4", prepaid: true, daysUntilDepletion: null }), // no estimate → out
      sub({ name: "P5", prepaid: true, daysUntilDepletion: 3, notify: false }), // muted → out
    ];
    const { topups } = selectReminders(subs, lead);
    expect(topups.map((s) => s.name)).toEqual(["P1", "P2"]);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/lib/reminders-select.test.ts`
Expected: FAIL — module/function not defined.

- [ ] **Step 3: Implement the pure selector**

Create `src/lib/reminders-select.ts`:

```ts
/** The minimal fields the reminder selector needs from an enriched subscription. */
type Remindable = {
  status: string;
  free: boolean;
  prepaid: boolean;
  notify: boolean;
  daysUntil: number;
  depletesOn: string | null;
  daysUntilDepletion: number | null;
};

/**
 * Split reminder-eligible subs into recurring renewals and prepaid top-ups.
 * A sub is due when it lands exactly on the lead day (the heads-up) or today
 * (the day-of) — the same clean cadence for both kinds, so neither nags.
 */
export function selectReminders<T extends Remindable>(
  subs: T[],
  lead: number,
): { renewals: T[]; topups: T[] } {
  const renewals = subs.filter(
    (s) =>
      s.status === "active" &&
      !s.free &&
      !s.prepaid &&
      s.notify &&
      (s.daysUntil === lead || s.daysUntil === 0),
  );
  const topups = subs.filter(
    (s) =>
      s.prepaid &&
      s.notify &&
      s.depletesOn !== null &&
      (s.daysUntilDepletion === lead || s.daysUntilDepletion === 0),
  );
  return { renewals, topups };
}
```

- [ ] **Step 4: Run the selector test to verify pass**

Run: `npx vitest run src/lib/reminders-select.test.ts` → PASS.

- [ ] **Step 5: Wire it into `runDailyReminders`**

In `src/lib/reminders.ts`, replace the inline `due` filter and message build so it uses the selector and covers both groups. Replace the block from `const due = listSubscriptions().filter(...)` through the end of the `title`/`notifyAll` construction with:

```ts
  const { renewals, topups } = selectReminders(listSubscriptions(), lead);
  const due = [...renewals, ...topups];
  if (due.length === 0) return { sent: 0, results: [] };

  const renewalLines = renewals.map((s) => {
    const when = s.daysUntil === 0 ? "today" : `in ${s.daysUntil} days`;
    return `• ${s.name} — ${formatCurrency(s.price, s.currencyCode)} renews ${when} (${s.nextRenewal})`;
  });
  const topupLines = topups.map((s) => {
    const when = s.daysUntilDepletion === 0 ? "today" : `in ${s.daysUntilDepletion} days`;
    return `• ${s.name} — credits run out ${when} (${s.depletesOn}) — top up soon`;
  });
  const lines = [...renewalLines, ...topupLines];

  const title =
    due.length === 1
      ? renewals.length === 1
        ? `${renewals[0].name} renews ${renewals[0].daysUntil === 0 ? "today" : `in ${renewals[0].daysUntil} days`}`
        : `${topups[0].name} credits run out ${topups[0].daysUntilDepletion === 0 ? "today" : `in ${topups[0].daysUntilDepletion} days`}`
      : `${due.length} subscriptions need attention`;

  const results = await notifyAll(settings, {
    title,
    message: lines.join("\n"),
    tags: ["moneybag"],
    priority: 4,
  });
```

Add the import at the top of `reminders.ts`:

```ts
import { selectReminders } from "@/lib/reminders-select";
```

(`due` is still used for the `sent: due.length` count at the end — keep that return block as-is.)

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reminders-select.ts src/lib/reminders-select.test.ts src/lib/reminders.ts
git commit -m "feat(reminders): prepaid top-up nudges from depletesOn"
```

---

## Task 6: Save path + Top up server action

**Files:**
- Modify: `src/app/(app)/subscriptions/actions.ts`

**Interfaces:**
- Consumes: `recordTopUp` (Task 2).
- Produces: `saveSubscription` handles `prepaid`/`depletesOn`; creating a prepaid sub records its first charge; editing one never adds a charge; recurring backfill/rebuild is skipped for prepaid. New action `topUp(id: number, amount: number, paidOn: string, depletesOn: string | null): Promise<SaveState>`.

- [ ] **Step 1: Add prepaid to the schema + parse**

In `src/app/(app)/subscriptions/actions.ts`, add to `SubscriptionSchema` (after the `free` field):

```ts
  prepaid: z.boolean(),
  depletesOn: z
    .string()
    .nullish()
    .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)),
```

Add to the `safeParse` object (mirroring how `free` and `endsOn` are read):

```ts
    prepaid: parseCheckbox(formData, "prepaid"),
    depletesOn: formData.get("depletesOn"),
```

- [ ] **Step 2: Handle prepaid in the save body**

In `saveSubscription`, after the existing `if (values.free) values.price = 0;` line, add a prepaid normalization block, and adjust the ledger side-effects. Replace the existing free/cancelled/backfill logic tail so prepaid is handled distinctly. Specifically:

After `const values = parsed.data;` and the free-price line, add:

```ts
  // Prepaid packs are one-off, never free, never cancelled, and carry no cycle.
  if (values.prepaid) {
    values.free = false;
    values.cancelled = false;
    values.endsOn = null;
  } else {
    values.depletesOn = null; // depletesOn only means anything for prepaid
  }
```

Then, in the try/catch that writes the row, change the ledger side-effects. The current insert branch does `if (!values.free) await safeBackfill(...)`. Replace the whole create/update ledger handling with prepaid-aware logic:

For the **update** (`if (id)`) branch, after `db.update(...).run()`, wrap the existing free/rebuild logic so prepaid does nothing to the ledger:

```ts
      if (values.prepaid) {
        // Editing a prepaid sub never adds/rebuilds charges — top-ups are explicit.
      } else if (values.free) {
        deletePaymentsForSub(id);
      } else {
        const scheduleChanged =
          !before ||
          before.free ||
          before.prepaid ||
          before.startDate !== values.startDate ||
          before.billingCycle !== values.billingCycle ||
          before.billingInterval !== values.billingInterval;
        if (scheduleChanged) await safeRebuild(id);
      }
```

For the **insert** (`else`) branch, replace `if (!values.free) await safeBackfill(...)` with:

```ts
      const newId = Number(info.lastInsertRowid);
      if (values.prepaid) {
        // Record the first purchase as a ledger charge.
        try {
          await recordTopUp(newId, values.startDate, values.price, values.currencyCode);
        } catch (e) {
          console.error("[squirrel] prepaid first-charge failed", e);
        }
      } else if (!values.free) {
        await safeBackfill(newId);
      }
```

(Ensure the insert captures `const info = db.insert(subscriptions).values(values).run();` — it already does.)

Add `recordTopUp` to the payments import at the top:

```ts
import {
  backfillPayments,
  rebuildPaymentsForSub,
  deletePaymentsForSub,
  recordTopUp,
} from "@/lib/payments";
```

- [ ] **Step 3: Add the `topUp` action**

Add near the other actions in the same file:

```ts
/**
 * Record a prepaid top-up: append a ledger charge and refresh the sub's stored
 * amount (the next prefill) and its "runs out around" estimate.
 */
export async function topUp(
  id: number,
  amount: number,
  paidOn: string,
  depletesOn: string | null,
): Promise<SaveState> {
  if (!(amount > 0)) return { error: "Amount must be greater than 0" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { error: "Invalid date" };
  const sub = getSubscription(id);
  if (!sub || !sub.prepaid) return { error: "Not a prepaid subscription" };

  try {
    await recordTopUp(id, paidOn, amount, sub.currencyCode);
    db.update(subscriptions)
      .set({ price: amount, depletesOn: depletesOn ?? null })
      .where(eq(subscriptions.id, id))
      .run();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Top up failed" };
  }

  revalidatePath("/subscriptions");
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/reports");
  return { ok: true };
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.
Run: `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/subscriptions/actions.ts"
git commit -m "feat(subscriptions): prepaid save path + topUp action"
```

---

## Task 7: Billing-type selector + prepaid fields on the form

**Files:**
- Modify: `src/components/subscription-sheet.tsx`

**Interfaces:**
- Consumes: `saveSubscription` reading `prepaid` + `depletesOn` (Task 6).
- Produces: the sheet lets you pick Recurring / Prepaid credits / Free, and shows prepaid fields when Prepaid is chosen.

- [ ] **Step 1: Add billing-type state**

In `src/components/subscription-sheet.tsx`, alongside the existing `free` state (`const [free, setFree] = useState(...)`), add a billing-type derived model. Introduce:

```ts
  const [billingType, setBillingType] = useState<"recurring" | "prepaid" | "free">(
    subscription?.prepaid ? "prepaid" : subscription?.free ? "free" : "recurring",
  );
  const [depletesOn, setDepletesOn] = useState(subscription?.depletesOn ?? "");
```

Reset both in the `useEffect(... [open, subscription, ...])` reset block (alongside the other `set*` calls):

```ts
    setBillingType(
      subscription?.prepaid ? "prepaid" : subscription?.free ? "free" : "recurring",
    );
    setDepletesOn(subscription?.depletesOn ?? "");
```

Derive booleans for the form:

```ts
  const isPrepaid = billingType === "prepaid";
  const isFree = billingType === "free";
```

Then replace usages of the old `free` state with `isFree` (the price/cycle grids are hidden with `free && "hidden"` → use `isFree || isPrepaid` where cycle/interval should hide for prepaid; see Step 3). Remove the standalone `free`/`setFree` state.

- [ ] **Step 2: Replace the "Free plan" switch with a 3-way selector**

Replace the existing "Free plan" bordered switch block with a segmented selector. Use the same Base UI `Select` pattern already in the file:

```tsx
          <div className="space-y-2">
            <Label>Billing type</Label>
            <Select
              value={billingType}
              onValueChange={(v) => setBillingType((v ?? "recurring") as typeof billingType)}
              items={{ recurring: "Recurring", prepaid: "Prepaid credits", free: "Free" }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recurring">Recurring</SelectItem>
                <SelectItem value="prepaid">Prepaid credits</SelectItem>
                <SelectItem value="free">Free</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isPrepaid
                ? "A pack you buy up front and top up — recorded as one-off charges."
                : isFree
                  ? "On a free tier — tracked for awareness, left out of spend."
                  : "Bills on a repeating cycle."}
            </p>
          </div>
```

- [ ] **Step 3: Hidden inputs + conditional fields**

Add hidden inputs the action reads (near the existing `free` hidden input / the `currencyCode`/`categoryId` hidden inputs):

```tsx
          <input type="hidden" name="free" value={isFree ? "on" : ""} />
          <input type="hidden" name="prepaid" value={isPrepaid ? "on" : ""} />
          <input type="hidden" name="depletesOn" value={isPrepaid ? depletesOn : ""} />
```

> `parseCheckbox` treats any non-null value as true, so `value=""` when off is correct only because unchecked switches are *absent*; a hidden input is always present. Use `value={isFree ? "on" : ""}` AND guard the parse: the existing `parseCheckbox` returns `fd.get(name) != null`, which would read `""` as true. To avoid that, DON'T render the hidden input when off — render conditionally:

```tsx
          {isFree ? <input type="hidden" name="free" value="on" /> : null}
          {isPrepaid ? <input type="hidden" name="prepaid" value="on" /> : null}
          {isPrepaid ? <input type="hidden" name="depletesOn" value={depletesOn} /> : null}
```

The price/cycle grid: the existing grid hides on `free`. Update its condition so cycle/interval hide for prepaid too, and relabel Price → "Amount paid" when prepaid. Find the price `<div className={cn("grid grid-cols-2 gap-3", free && "hidden")}>` (price + currency) and change `free` → `isFree`. For the price label, make it dynamic:

```tsx
              <Label htmlFor="price">{isPrepaid ? "Amount paid" : "Price"}</Label>
```

Find the billing-interval/cycle grid (`<div className={cn("grid grid-cols-2 gap-3", free && "hidden")}>` containing "Bills every"/"Cycle") and change its condition to hide when free OR prepaid:

```tsx
          <div className={cn("grid grid-cols-2 gap-3", (isFree || isPrepaid) && "hidden")}>
```

Relabel the start-date field when prepaid (find the `startDate` Label "Start / first payment date"):

```tsx
            <Label htmlFor="startDate">{isPrepaid ? "Purchase date" : "Start / first payment date"}</Label>
```

Add the "Runs out around" field, shown only when prepaid — place it right after the start-date field block:

```tsx
          {isPrepaid ? (
            <div className="space-y-2">
              <Label htmlFor="depletesOn">Runs out around (optional)</Label>
              <Input
                id="depletesOn"
                type="date"
                value={depletesOn}
                onChange={(e) => setDepletesOn(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                We'll remind you to top up before this date. Leave blank if you're not sure.
              </p>
            </div>
          ) : null}
```

Also hide the "Cancelled" bordered block when prepaid (prepaid subs don't cancel). Find the cancelled block wrapper and add a guard so it only renders when `!isPrepaid && !isFree` (cancellation already only makes sense for recurring). If it's currently always rendered, wrap it: `{!isPrepaid ? ( ...cancelled block... ) : null}`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → succeeds.
Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/subscription-sheet.tsx
git commit -m "feat(form): billing-type selector with prepaid credits fields"
```

---

## Task 8: Prepaid card + Top-up dialog

**Files:**
- Modify: `src/components/subscriptions-view.tsx`

**Interfaces:**
- Consumes: `topUp` action (Task 6), enriched `prepaid`/`depletesOn`/`daysUntilDepletion`/`depleted`.
- Produces: prepaid cards render differently (badge + credits/topped-up/runs-out line), and a "Top up" menu item opens a dialog that calls `topUp`.

- [ ] **Step 1: Badge + status line for prepaid**

In `src/components/subscriptions-view.tsx`:

Extend `statusBadge` to show a "Prepaid" badge. At the top of `statusBadge(sub)`, before the switch, add:

```ts
  if (sub.prepaid) {
    return {
      label: "Prepaid",
      className:
        "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-400",
    };
  }
```

Extend `statusLine` for prepaid. At the top of `statusLine(sub)`, before the existing cancelled/expired handling, add:

```ts
  if (sub.prepaid) {
    if (sub.depletesOn === null) {
      return { text: "Prepaid", tone: "text-muted-foreground" };
    }
    const d = sub.daysUntilDepletion ?? 0;
    if (d < 0) {
      return { text: `Ran out ~${sub.depletesOn}`, tone: "text-muted-foreground", sub: sub.depletesOn };
    }
    const text = d === 0 ? "Runs out today" : d === 1 ? "Runs out tomorrow" : `Runs out in ${d} days`;
    const tone = d <= 7 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
    return { text, tone, sub: sub.depletesOn };
  }
```

The main price line: prepaid should read as a credit pack, not a recurring price. Find the card's price block (the `sub.free ? <Free> : <price + describeCycle>` region) and add a prepaid branch. Change the outer conditional so it reads:

```tsx
                    {sub.free ? (
                      <p className="text-lg font-semibold">Free</p>
                    ) : sub.prepaid ? (
                      <>
                        <p className="text-lg font-semibold">
                          {formatCurrency(sub.price, sub.currencyCode)}
                        </p>
                        <p className="text-xs text-muted-foreground">credits</p>
                      </>
                    ) : (
                      <>
                        {/* existing recurring price + describeCycle block unchanged */}
                      </>
                    )}
```

(Keep the existing recurring block verbatim inside the final branch.)

The bottom-right `line` is already rendered for `!sub.free`; prepaid should show it too — change the guard `{!sub.free ? (` around the status line to `{!sub.free ? (` staying as-is is fine since prepaid is not free, so `line` renders. Confirm the status-line region renders for prepaid (it will, because `!sub.free` is true).

- [ ] **Step 2: "Top up" menu item + dialog state**

Add the imports at the top: `topUp` from the actions, and a `Plus`/`Coins` icon from lucide (reuse an existing imported icon if present — `Plus` is already imported). Add dialog state in the `SubscriptionsView` component alongside `deleteTarget`:

```ts
  const [topUpTarget, setTopUpTarget] = useState<EnrichedSubscription | null>(null);
```

In the card dropdown menu (`DropdownMenuContent`), add a Top-up item shown only for prepaid, right above the Edit item:

```tsx
                      {sub.prepaid ? (
                        <DropdownMenuItem onClick={() => setTopUpTarget(sub)}>
                          <Plus className="size-4" />
                          Top up
                        </DropdownMenuItem>
                      ) : null}
```

- [ ] **Step 3: The Top-up dialog**

Add a controlled dialog near the delete `Dialog` at the end of the component. It needs local amount/date/depletesOn state — extract a small child component to keep hooks clean:

```tsx
function TopUpDialog({
  target,
  onClose,
}: {
  target: EnrichedSubscription | null;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [runsOut, setRunsOut] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (target) {
      setAmount(String(target.price ?? ""));
      setDate(new Date().toISOString().slice(0, 10));
      setRunsOut(target.depletesOn ?? "");
    }
  }, [target]);

  async function submit() {
    if (!target) return;
    const amt = Number(amount);
    if (!(amt > 0)) {
      toast.error("Enter an amount greater than 0");
      return;
    }
    setPending(true);
    const res = await topUp(target.id, amt, date, runsOut || null);
    setPending(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Topped up");
      onClose();
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Top up {target?.name}</DialogTitle>
          <DialogDescription>
            Records a one-off charge and updates when it runs out.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tuAmount">Amount ({target?.currencyCode})</Label>
              <Input id="tuAmount" type="number" step="0.01" min="0" value={amount}
                onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tuDate">Date</Label>
              <Input id="tuDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tuRunsOut">Runs out around (optional)</Label>
            <Input id="tuRunsOut" type="date" value={runsOut} onChange={(e) => setRunsOut(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Top up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Render it in `SubscriptionsView` (next to the delete Dialog):

```tsx
      <TopUpDialog target={topUpTarget} onClose={() => setTopUpTarget(null)} />
```

Add any missing imports: `useEffect` from react (already imported? add if not), `LoaderCircle` from lucide, and `topUp` from `@/app/(app)/subscriptions/actions`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → succeeds.
Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/subscriptions-view.tsx
git commit -m "feat(subscriptions): prepaid card + top-up dialog"
```

---

## Task 9: Calendar — runs-out markers

**Files:**
- Modify: `src/components/calendar-view.tsx`

**Interfaces:**
- Consumes: enriched `prepaid`/`depletesOn`.
- Produces: prepaid subs place a single distinct marker on `depletesOn` (not recurring renewal markers).

- [ ] **Step 1: Add a marker kind and the depletion pass**

In `src/components/calendar-view.tsx`, change `DayEntry` to carry a kind:

```ts
type DayEntry = { sub: EnrichedSubscription; kind: "renewal" | "depletion" };
```

In the `byDay` memo, exclude prepaid from the renewal loop and add a depletion pass. Update the `active` filter and the push, then add the second loop:

```ts
    const active = subscriptions.filter(
      (s) => s.status === "active" && !s.free && !s.prepaid,
    );
    for (const sub of active) {
      const dates = renewalsInRange(
        sub.startDate, sub.billingCycle as BillingCycle, sub.billingInterval,
        gridStart, gridEnd,
      );
      for (const d of dates) {
        const key = toISODate(d);
        const list = map.get(key) ?? [];
        list.push({ sub, kind: "renewal" });
        map.set(key, list);
      }
    }
    // Prepaid subs: a single "runs out ~" marker on their depletesOn date.
    for (const sub of subscriptions) {
      if (!sub.prepaid || !sub.depletesOn) continue;
      if (sub.depletesOn < toISODate(gridStart) || sub.depletesOn > toISODate(gridEnd)) continue;
      const list = map.get(sub.depletesOn) ?? [];
      list.push({ sub, kind: "depletion" });
      map.set(sub.depletesOn, list);
    }
```

- [ ] **Step 2: Distinct dot colour + detail wording**

In the day-cell dots, colour depletion markers amber instead of the category colour:

```tsx
                        {entries.slice(0, 3).map((e, i) => (
                          <span
                            key={i}
                            className="size-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                e.kind === "depletion"
                                  ? "#d97706"
                                  : e.sub.categoryColor ?? "#64748b",
                            }}
                          />
                        ))}
```

In the selected-day detail rows, show top-up wording for depletion entries. In the `selectedEntries.map(({ sub }, i) => ...)`, change the destructure to `({ sub, kind }, i)` and adjust the right-hand figure/label:

```tsx
                <p className="text-sm font-medium">
                  {kind === "depletion" ? "runs out" : formatCurrency(sub.price, sub.currencyCode)}
                </p>
```

Also fix the header count wording — "renewals" is no longer always right. Change the `CardDescription` for the selected day to a neutral noun:

```tsx
              {selectedEntries.length === 0
                ? "Nothing due on this day."
                : `${selectedEntries.length} item${selectedEntries.length > 1 ? "s" : ""}`}
```

And guard the "Total that day" so depletion markers (which have no cash value that day) don't inflate it — sum only renewal entries:

```ts
  const selectedTotal = selectedEntries
    .filter((e) => e.kind === "renewal")
    .reduce((s, e) => s + e.sub.priceBase, 0);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → succeeds.
Run: `npm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/calendar-view.tsx
git commit -m "feat(calendar): runs-out markers for prepaid subs"
```

---

## Task 10: Backup + CSV export round-trip

**Files:**
- Modify: `src/lib/backup.ts`
- Modify: `src/lib/backup.test.ts`
- Modify: `src/lib/export.ts`

**Interfaces:**
- Produces: backup JSON round-trips `prepaid`/`depletesOn`; subscriptions CSV export includes a "Prepaid" column.

- [ ] **Step 1: Write the failing test**

In `src/lib/backup.test.ts`, add a case asserting a backup with a prepaid sub round-trips, AND that an old backup (no `prepaid`/`depletesOn` keys) still parses with concrete defaults:

```ts
it("round-trips prepaid + depletesOn and defaults them for old backups", () => {
  const withPrepaid = {
    app: "squirrel", schema: 1,
    data: {
      settings: [], categories: [], contexts: [], paymentMethods: [], payments: [],
      subscriptions: [{
        id: 1, name: "Credits", logoUrl: null, url: null, price: 50,
        currencyCode: "GBP", billingCycle: "month", billingInterval: 1,
        startDate: "2026-01-01", trialEndDate: null, categoryId: null,
        contextId: null, paymentMethodId: null, notes: null, active: true,
        notify: true, free: false, cancelled: false, endsOn: null,
        prepaid: true, depletesOn: "2026-03-01", createdAt: "2026-01-01T00:00:00.000Z",
      }],
    },
  };
  const res = parseBackup(JSON.stringify(withPrepaid));
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.data.data.subscriptions[0].prepaid).toBe(true);
    expect(res.data.data.subscriptions[0].depletesOn).toBe("2026-03-01");
  }

  // Old backup shape: no prepaid/depletesOn keys on the subscription.
  const old = JSON.parse(JSON.stringify(withPrepaid));
  delete old.data.subscriptions[0].prepaid;
  delete old.data.subscriptions[0].depletesOn;
  const res2 = parseBackup(JSON.stringify(old));
  expect(res2.ok).toBe(true);
  if (res2.ok) {
    expect(res2.data.data.subscriptions[0].prepaid).toBe(false);
    expect(res2.data.data.subscriptions[0].depletesOn).toBeNull();
  }
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/lib/backup.test.ts`
Expected: FAIL — `prepaid`/`depletesOn` are stripped (unknown keys) so the first assertion fails.

- [ ] **Step 3: Add the fields to `SubscriptionRow`**

In `src/lib/backup.ts`, add to `SubscriptionRow` (after `endsOn`), using `.default(...)` for backwards compatibility (concrete values, matching how `contextId` was handled):

```ts
  prepaid: z.boolean().default(false),
  depletesOn: z.string().nullable().default(null),
```

- [ ] **Step 4: Add a CSV export column**

In `src/lib/export.ts`, `buildSubscriptionsCsv`: add a `"Prepaid"` header (after `"Free"`) and a matching cell (`s.prepaid ? "yes" : "no"`) in the row map, in the SAME position. (No CSV import support — out of scope.)

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run src/lib/backup.test.ts` → PASS.
Run: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backup.ts src/lib/backup.test.ts src/lib/export.ts
git commit -m "feat(data): round-trip prepaid through backup + CSV export"
```

---

## Task 11: Version bump + docs

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Bump version**

`package.json`: `"version": "1.9.0"` → `"version": "1.10.0"`.

- [ ] **Step 2: README**

Add a **Prepaid / credit subs** bullet to the `## Features` list (after the "Cancellations" or "Free-tier tracking" bullet), and a short `## Prepaid & credit subscriptions` usage subsection near the Contexts one. Cover: choose "Prepaid credits" as the billing type; each purchase/top-up is a one-off charge (counts in Reports, not in the normalized dashboard total); the "runs out around" date drives a top-up reminder; use the card's "Top up" action to log a top-up. Match the README's existing concise, shipped-reality voice.

- [ ] **Step 3: Final verification**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore: v1.10.0 — prepaid/credit subscriptions"
```

- [ ] **Step 5: Release (after merge to main — per AGENTS.md)**

> Not run inside the worktree branch. After merge to `main`:
> 1. `git tag -a v1.10.0 -m "v1.10.0"` and push the tag (triggers the GHCR build).
> 2. `gh release create v1.10.0 --verify-tag --title "v1.10.0" --notes "..." --latest`.
> Also worth updating the `squirrel-site` landing page with a prepaid feature card (separate repo).

---

## Manual smoke test (after Task 10, before release)

`npm run dev`, then:
1. Add a sub → Billing type **Prepaid credits** → Amount 50, Purchase date today, Runs out around +20 days. Card shows a **Prepaid** badge, "£50 credits", "Runs out in 20 days".
2. Reports → this month shows a £50 spike. Dashboard **Monthly spend** is unchanged (prepaid excluded); the sub IS in the active count.
3. Card menu → **Top up** → £30 today → Reports this month now shows £80; card amount shows £30; runs-out date updated.
4. Two top-ups the same day → they sum into one day's charge.
5. Calendar → an amber "runs out" marker on the depletes date; the day detail reads "runs out", no cash total.
6. Set a lead-days reminder + a depletes date at lead distance → "Run reminders now" sends a "credits run out" nudge.
7. Backup → restore → prepaid sub + its charges survive.

---

## Self-review

**Spec coverage:** prepaid mode + depletesOn (T1); ledger charges + same-day sum + backfill skip (T2); enriched fields + zero recurring cost (T3); dashboard/reports exclusion (T4); top-up reminders (T5); save path + topUp action + create-records-first-charge (T6); form billing-type + fields (T7); card + top-up dialog (T8); calendar marker (T9); backup/CSV round-trip (T10); version + docs (T11). Manual smoke test covers the end-to-end flow. ✅

**Placeholder scan:** no TBD/"handle edge cases"/"similar to Task N"; each mirrored block is written out. ✅

**Type consistency:** `recordTopUp(subId, paidOn, amount, currencyCode)` identical in T2/T6. `topUp(id, amount, paidOn, depletesOn)` identical in T6/T8. `selectReminders(subs, lead) → {renewals, topups}` identical T5. `daysUntilDepletion`/`depleted`/`prepaid`/`depletesOn` enriched fields consistent across T3/T4/T5/T8/T9. Billing-type strings `"recurring"|"prepaid"|"free"` consistent in T7. ✅

**Known verification note for implementers:** the temp-DB test harness (T2, and the additions in T3) must be copied from the existing `src/lib/subscriptions.test.ts` — it already solves the `server-only`-under-Vitest problem via the stub in `vitest.config.ts`. Confirm that harness exists before writing T2's test; if it doesn't, read `src/lib/subscriptions.test.ts` to replicate it.
