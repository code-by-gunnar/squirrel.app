# Subscription Contexts (Personal / Work) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user tag each subscription with a user-managed "context" (Personal, Work, …) and re-scope every total across the app to the selected context.

**Architecture:** A new `contexts` reference table (mirrors `categories`) plus a nullable `context_id` on `subscriptions`. A global header switcher persists the active context in a cookie; each server page reads the cookie and passes a filter into the existing data-access functions, which add a single `WHERE` clause. All downstream stats/charts/calendar recompute off the already-filtered list — no aggregation math changes except Reports, which filters the payments ledger by the context's subscription ids.

**Tech Stack:** Next.js 16 (App Router, server components + server actions), Drizzle ORM + better-sqlite3, Zod, React 19, Tailwind + Base-UI-backed shadcn components, Vitest.

## Global Constraints

- **Next.js is non-standard here.** Per `AGENTS.md`: this Next.js version has breaking changes vs. training data. Before using the cookies API (`next/headers`), read `node_modules/next/dist/docs/` for the current `cookies()` contract. In this version `cookies()` is async — always `await cookies()`.
- **shadcn is Base UI here** (not Radix). `Select`'s `onValueChange` can fire with `null` — always coalesce (`v ?? "all"`). Use `render` prop, not `asChild`. (See existing `subscriptions-view.tsx` selects.)
- **Form null fields:** conditionally-rendered inputs submit as `null`. In the save action's Zod schema use `.nullish()` (not `.optional()`) for anything that may be absent. Reuse the existing `optionalId` helper for `contextId` — it already maps `"none"`/absent → `null`.
- **Dates** are ISO `"YYYY-MM-DD"` strings. **Money** in enriched subs is already base-currency-converted.
- **Naming:** entity is `contexts` / `context_id` / `contextId` in code; label is **"Context"** in the UI.
- **Every mutating server action** must `revalidatePath` the pages it affects (`/`, `/subscriptions`, `/calendar`, `/reports`, `/settings`) — match the existing actions.
- **Commit** after each task with the shown message. Run `npm test` (Vitest) before every commit; it must pass.
- Version bumps: `package.json` 1.8.0 → 1.9.0 (final task only).

---

## File structure

**Modified:**
- `src/db/schema.ts` — `contexts` table, `contextId` column + index, exported types.
- `src/db/seed.ts` — seed Personal + Work when `contexts` is empty.
- `src/lib/subscriptions.ts` — `getContexts()`, enriched `contextName`/`contextColor`, `listSubscriptions(filter)`.
- `src/lib/reports.ts` — `getMonthlySpend(filter)`, `getSpendTotals(filter)`.
- `src/components/app-shell.tsx` — render `<ContextSwitcher>` in header; accept props.
- `src/app/(app)/layout.tsx` — fetch contexts + active filter, pass to `AppShell`.
- `src/app/(app)/page.tsx`, `calendar/page.tsx`, `reports/page.tsx`, `subscriptions/page.tsx` — read active context filter, pass down.
- `src/components/subscription-sheet.tsx` — Context select; `contexts` + `defaultContextId` props.
- `src/components/subscriptions-view.tsx` — pass `contexts`/`defaultContextId` to the sheet; render context pill on card.
- `src/app/(app)/subscriptions/actions.ts` — `contextId` in the Zod schema + parse.
- `src/app/(app)/settings/actions.ts` — context CRUD actions; context handling in CSV preview/import + backup restore.
- `src/components/settings-view.tsx` — `ContextsCard`; pass `contexts` prop through.
- `src/app/(app)/settings/page.tsx` — pass `getContexts()`.
- `src/lib/import-csv.ts` — optional `Context` column parse + template.
- `src/lib/export.ts` — contexts in backup; Context column in subscriptions CSV.
- `src/lib/backup.ts` — `ContextRow`, `contexts` array, `contextId` on `SubscriptionRow`.
- `package.json` — version bump.

**Created:**
- `drizzle/0004_*.sql` + `drizzle/meta/*` — generated migration (DDL only).
- `src/lib/contexts.ts` — cookie constant, `ContextFilter` type, pure `resolveContextFilter()`, server `getActiveContextFilter()`, helper `subscriptionIdsForContext()`.
- `src/lib/context-actions.ts` — `"use server"` `setActiveContext(value)`.
- `src/components/context-switcher.tsx` — client header dropdown.
- `src/lib/contexts.test.ts` — unit tests for `resolveContextFilter`.

---

## Task 1: Schema, migration & seed

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/seed.ts`
- Create: `drizzle/0004_*.sql` (generated)
- Test: `src/lib/billing.test.ts` is unaffected; verification is via a temp script + existing suite.

**Interfaces:**
- Produces: `contexts` table; `subscriptions.contextId: number | null`; exported `Context` / `NewContext` types.

- [ ] **Step 1: Add the `contexts` table to the schema**

In `src/db/schema.ts`, add immediately after the `categories` table (line 19):

```ts
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
```

- [ ] **Step 2: Add the `contextId` column + index to `subscriptions`**

In the `subscriptions` table, add this field right after the `categoryId` block (after line 53):

```ts
    contextId: integer("context_id").references(() => contexts.id, {
      onDelete: "set null",
    }),
```

Add an index in the table's index array (alongside `idx_subscriptions_category`, line 75):

```ts
    index("idx_subscriptions_context").on(t.contextId),
```

- [ ] **Step 3: Export the new types**

At the bottom of `src/db/schema.ts`, after the `Category` type export (line 132):

```ts
export type Context = typeof contexts.$inferSelect;
export type NewContext = typeof contexts.$inferInsert;
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate` (confirmed script → `drizzle-kit generate`).
Expected: a new `drizzle/0004_*.sql` creating `contexts`, adding `context_id` to `subscriptions`, creating `idx_subscriptions_context`, plus an updated `drizzle/meta/_journal.json` and snapshot.

Open the generated `0004_*.sql` and confirm it contains (SQLite ALTER for the FK column is emitted as a plain `ADD COLUMN`):

```sql
CREATE TABLE `contexts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `context_id` integer REFERENCES contexts(id);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_context` ON `subscriptions` (`context_id`);
```

Config lives in `drizzle.config.ts`.

- [ ] **Step 5: Seed Personal + Work when empty**

In `src/db/seed.ts`, add the import (line 3) and a default list + seed block. Update the import:

```ts
import { categories, contexts, paymentMethods, settings } from "./schema";
```

Add after `DEFAULT_CATEGORIES` (line 35):

```ts
const DEFAULT_CONTEXTS: { name: string; color: string }[] = [
  { name: "Personal", color: "#6366f1" },
  { name: "Work", color: "#0ea5e9" },
];
```

Inside `seedDefaults`, after the categories seed block (after line 53), add:

```ts
  const ctxCount = db.get<{ c: number }>(sql`SELECT COUNT(*) as c FROM contexts`);
  if (!ctxCount || ctxCount.c === 0) {
    db.insert(contexts).values(DEFAULT_CONTEXTS).run();
  }
```

- [ ] **Step 6: Verify the migration applies and seeds**

Run the existing suite (it boots the DB, applies migrations, seeds):

Run: `npm test`
Expected: PASS (76 tests, 0 failures) — no regressions from the schema change.

Then verify the table exists and is seeded with a throwaway check:

Run: `node -e "const D=require('better-sqlite3'); const db=new D('./data/squirrel.db'); console.log(db.prepare('SELECT name FROM contexts ORDER BY id').all());"`
Expected: `[ { name: 'Personal' }, { name: 'Work' } ]` (data dir may need the dev server or a test to have run once first; if `./data/squirrel.db` doesn't exist, run `npm run dev` briefly or rely on Step's test run which uses an in-memory/temp DB — the assertion is simply that migration + seed code is present and tests pass).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/seed.ts drizzle/
git commit -m "feat(db): add contexts table, context_id column, seed Personal/Work"
```

---

## Task 2: Data access — contexts list, enriched fields, filtered list

**Files:**
- Modify: `src/lib/subscriptions.ts`

**Interfaces:**
- Consumes: `contexts` table (Task 1).
- Produces:
  - `getContexts(): Context[]`
  - `EnrichedSubscription` gains `contextName: string | null`, `contextColor: string | null`.
  - `listSubscriptions(filter?: ContextFilter): EnrichedSubscription[]` where `ContextFilter = number | "all" | "unassigned"` (imported from `@/lib/contexts` in Task 3; for THIS task, define the param type inline as shown and Task 3 re-exports the canonical type — keep the union identical).

> Note: to avoid an import cycle (`contexts.ts` imports `getContexts` from `subscriptions.ts`), the `ContextFilter` type lives in `contexts.ts` and is imported here as a *type-only* import. `import type` does not create a runtime cycle.

- [ ] **Step 1: Import contexts schema + filter helpers**

In `src/lib/subscriptions.ts`, update the imports:

```ts
import { desc, eq, isNull, type SQL } from "drizzle-orm";
```

Add `contexts` to the schema import (line 4-10 block):

```ts
import {
  subscriptions,
  categories,
  contexts,
  paymentMethods,
  fxRates,
  type Subscription,
  type Context,
} from "@/db/schema";
```

Add a type-only import at the top (after the existing imports):

```ts
import type { ContextFilter } from "@/lib/contexts";
```

- [ ] **Step 2: Add `getContexts` and extend the enriched type**

Add `contextName`/`contextColor` to `EnrichedSubscription` (after `categoryColor`, line 34):

```ts
  contextName: string | null;
  contextColor: string | null;
```

Add the accessor next to `getCategories` (after line 66):

```ts
export function getContexts(): Context[] {
  return db.select().from(contexts).orderBy(contexts.name).all();
}
```

- [ ] **Step 3: Filter + join in `listSubscriptions`**

Change the signature (line 80):

```ts
export function listSubscriptions(
  filter: ContextFilter = "all",
): EnrichedSubscription[] {
```

Build the where-clause before the query (after `const from = new Date();`, line 83):

```ts
  const where: SQL | undefined =
    filter === "all"
      ? undefined
      : filter === "unassigned"
        ? isNull(subscriptions.contextId)
        : eq(subscriptions.contextId, filter);
```

Add the context join + selected columns and the `.where(where)` to the query (the `db.select({...}).from(...)` block, lines 85-96):

```ts
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
```

Update the `.map(...)` destructure + returned object to carry the new fields (lines 98 and 109-122):

```ts
  return rows.map(
    ({ sub, categoryName, categoryColor, contextName, contextColor, paymentMethodName }) => {
```

and in the returned object literal, alongside `categoryName`/`categoryColor`:

```ts
      contextName,
      contextColor,
```

- [ ] **Step 4: Verify it compiles and existing tests pass**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS (76 tests). `listSubscriptions()` with no arg still returns everything (default `"all"`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/subscriptions.ts
git commit -m "feat(subscriptions): getContexts + context filter on listSubscriptions"
```

---

## Task 3: Context cookie helper + validation (pure + server)

**Files:**
- Create: `src/lib/contexts.ts`
- Create: `src/lib/contexts.test.ts`

**Interfaces:**
- Produces:
  - `CONTEXT_COOKIE = "squirrel_context"`
  - `type ContextFilter = number | "all" | "unassigned"`
  - `resolveContextFilter(raw: string | undefined, liveIds: Set<number>): ContextFilter` (pure)
  - `getActiveContextFilter(): Promise<ContextFilter>` (server; reads cookie + live contexts)
  - `subscriptionIdsForContext(filter: ContextFilter): number[] | null` (null = "all", i.e. no filter)

- [ ] **Step 1: Write the failing test for `resolveContextFilter`**

Create `src/lib/contexts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveContextFilter } from "./contexts";

describe("resolveContextFilter", () => {
  const live = new Set([1, 2]);

  it("returns 'all' when the cookie is absent", () => {
    expect(resolveContextFilter(undefined, live)).toBe("all");
  });

  it("returns 'all' for an empty string", () => {
    expect(resolveContextFilter("", live)).toBe("all");
  });

  it("returns 'unassigned' verbatim", () => {
    expect(resolveContextFilter("unassigned", live)).toBe("unassigned");
  });

  it("returns the numeric id when it is a live context", () => {
    expect(resolveContextFilter("2", live)).toBe(2);
  });

  it("falls back to 'all' for a stale/deleted id", () => {
    expect(resolveContextFilter("99", live)).toBe("all");
  });

  it("falls back to 'all' for non-numeric junk", () => {
    expect(resolveContextFilter("abc", live)).toBe("all");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/contexts.test.ts`
Expected: FAIL — cannot resolve `./contexts` / `resolveContextFilter` is not defined.

- [ ] **Step 3: Implement `src/lib/contexts.ts`**

> Before writing `getActiveContextFilter`, confirm the `cookies()` signature in this Next version (read `node_modules/next/dist/docs/` per Global Constraints). It is async here.

```ts
import "server-only";
import { cookies } from "next/headers";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { isNull, eq } from "drizzle-orm";
import { getContexts } from "@/lib/subscriptions";

export const CONTEXT_COOKIE = "squirrel_context";

/** Which subscriptions to include: a specific context, only untagged, or all. */
export type ContextFilter = number | "all" | "unassigned";

/**
 * Map a raw cookie value to a safe filter. Pure so it is unit-testable and can
 * never trust a stale/hand-edited cookie: an id that is not currently live
 * degrades to "all" rather than showing an empty app.
 */
export function resolveContextFilter(
  raw: string | undefined,
  liveIds: Set<number>,
): ContextFilter {
  if (raw === "unassigned") return "unassigned";
  if (raw && /^\d+$/.test(raw)) {
    const id = Number(raw);
    if (liveIds.has(id)) return id;
  }
  return "all";
}

/** Read the active context from the cookie, validated against live contexts. */
export async function getActiveContextFilter(): Promise<ContextFilter> {
  const raw = (await cookies()).get(CONTEXT_COOKIE)?.value;
  const liveIds = new Set(getContexts().map((c) => c.id));
  return resolveContextFilter(raw, liveIds);
}

/**
 * The subscription ids in scope for a filter, or `null` for "all" (meaning: do
 * not filter). Used by the payments-ledger queries in Reports, which have no
 * context column of their own and must scope via subscription_id.
 */
export function subscriptionIdsForContext(filter: ContextFilter): number[] | null {
  if (filter === "all") return null;
  const rows = db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      filter === "unassigned"
        ? isNull(subscriptions.contextId)
        : eq(subscriptions.contextId, filter),
    )
    .all();
  return rows.map((r) => r.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/contexts.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/contexts.ts src/lib/contexts.test.ts
git commit -m "feat(contexts): cookie filter helper with stale-id fallback"
```

---

## Task 4: Header context switcher

**Files:**
- Create: `src/lib/context-actions.ts`
- Create: `src/components/context-switcher.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getContexts()` (Task 2), `getActiveContextFilter()`, `CONTEXT_COOKIE` (Task 3).
- Produces: `setActiveContext(value: string): Promise<void>` server action; `<ContextSwitcher contexts current />`; `AppShell` gains `contexts: Context[]` and `activeContext: string` props.

- [ ] **Step 1: Server action to persist the choice**

Create `src/lib/context-actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { CONTEXT_COOKIE } from "@/lib/contexts";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Persist the active context selection. Value is "all" | "unassigned" | "<id>". */
export async function setActiveContext(value: string): Promise<void> {
  const safe = value === "all" || value === "unassigned" || /^\d+$/.test(value)
    ? value
    : "all";
  (await cookies()).set(CONTEXT_COOKIE, safe, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  });
  revalidatePath("/");
  revalidatePath("/subscriptions");
  revalidatePath("/calendar");
  revalidatePath("/reports");
}
```

- [ ] **Step 2: The switcher client component**

Create `src/components/context-switcher.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import type { Context } from "@/db/schema";
import { setActiveContext } from "@/lib/context-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ContextSwitcher({
  contexts,
  current,
}: {
  contexts: Context[];
  current: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const items: Record<string, string> = {
    all: "All contexts",
    unassigned: "Unassigned",
    ...Object.fromEntries(contexts.map((c) => [String(c.id), c.name])),
  };

  function onChange(value: string | null) {
    const next = value ?? "all";
    start(async () => {
      await setActiveContext(next);
      router.refresh();
    });
  }

  return (
    <Select value={current} onValueChange={onChange} items={items}>
      <SelectTrigger
        className="h-9 w-auto gap-1.5 border-none bg-transparent px-2 text-sm text-muted-foreground shadow-none hover:text-foreground data-[disabled]:opacity-100"
        disabled={pending}
        aria-label="Filter by context"
      >
        <Layers className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="all">All contexts</SelectItem>
        {contexts.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            <span className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              {c.name}
            </span>
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value="unassigned">Unassigned</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

> `SelectSeparator` is exported from `src/components/ui/select.tsx` (confirmed) — import it alongside the other Select parts.

- [ ] **Step 3: Render the switcher in the header**

In `src/components/app-shell.tsx`, add the import and a `Context` type import at the top:

```tsx
import type { Context } from "@/db/schema";
import { ContextSwitcher } from "@/components/context-switcher";
```

Change the component signature (line 43):

```tsx
export function AppShell({
  children,
  contexts,
  activeContext,
}: {
  children: React.ReactNode;
  contexts: Context[];
  activeContext: string;
}) {
```

In the header, place the switcher to the left of the theme toggle. Replace the `ml-auto` cluster (lines 96-109) so it reads:

```tsx
          <div className="ml-auto flex items-center gap-1">
            <ContextSwitcher contexts={contexts} current={activeContext} />
            <ThemeToggle />
            <form action={logout} className="md:hidden">
              <Button
                variant="ghost"
                size="icon"
                type="submit"
                aria-label="Sign out"
                className="text-muted-foreground"
              >
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
```

- [ ] **Step 4: Feed the switcher from the layout**

Replace `src/app/(app)/layout.tsx` entirely:

```tsx
import { AppShell } from "@/components/app-shell";
import { getContexts } from "@/lib/subscriptions";
import { getActiveContextFilter } from "@/lib/contexts";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const contexts = getContexts();
  const active = await getActiveContextFilter();
  return (
    <AppShell contexts={contexts} activeContext={String(active)}>
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 5: Verify build + tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS (still 82 tests incl. Task 3's 6).

Run: `npm run build`
Expected: builds successfully (validates the async layout + server action wiring).

- [ ] **Step 6: Commit**

```bash
git add src/lib/context-actions.ts src/components/context-switcher.tsx src/components/app-shell.tsx "src/app/(app)/layout.tsx"
git commit -m "feat(ui): global context switcher in the header"
```

---

## Task 5: Settings — context CRUD

**Files:**
- Modify: `src/app/(app)/settings/actions.ts`
- Modify: `src/components/settings-view.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `contexts` table, `getContexts()`.
- Produces: `addContext(name, color)`, `updateContext(id, name, color)`, `deleteContext(id)` (all `Promise<ActionState>`); `SettingsView` gains a `contexts: Context[]` prop.

- [ ] **Step 1: Add the CRUD server actions**

In `src/app/(app)/settings/actions.ts`, add `contexts` to the schema import (line 6-12 block):

```ts
import {
  categories,
  contexts,
  paymentMethods,
  subscriptions,
  payments,
  settings,
} from "@/db/schema";
```

Add a `// --- Contexts ---` section after the Categories block (after line 134):

```ts
// --- Contexts ---

export async function addContext(name: string, color: string): Promise<ActionState> {
  const n = name.trim();
  if (!n) return { error: "Name required" };
  db.insert(contexts).values({ name: n, color: color || "#6366f1" }).run();
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  return { ok: true };
}

export async function updateContext(
  id: number,
  name: string,
  color: string,
): Promise<ActionState> {
  const n = name.trim();
  if (!n) return { error: "Name required" };
  db.update(contexts).set({ name: n, color }).where(eq(contexts.id, id)).run();
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteContext(id: number): Promise<ActionState> {
  // IMPORTANT: SQLite's `ALTER TABLE ADD COLUMN ... REFERENCES` (how context_id
  // was added in migration 0004) does NOT enforce ON DELETE SET NULL — unlike
  // categoryId, whose FK is inline in the original CREATE TABLE. So a bare
  // `DELETE FROM contexts` would throw "FOREIGN KEY constraint failed" for any
  // context still assigned. Null the assignments first, then delete — atomically.
  db.transaction((tx) => {
    tx.update(subscriptions)
      .set({ contextId: null })
      .where(eq(subscriptions.contextId, id))
      .run();
    tx.delete(contexts).where(eq(contexts.id, id)).run();
  });
  revalidatePath("/settings");
  revalidatePath("/subscriptions");
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/reports");
  return { ok: true };
}
```

> `subscriptions` and `contexts` are both already imported in this file (subscriptions via the backup imports, contexts added in this task's Step 1).
>
> Stale-cookie safety: if the deleted context was the active one, the cookie now points at a dead id. No extra work needed — `resolveContextFilter` (Task 3) already degrades a non-live id to "all" on the next read.

> **Add a test for this behavior.** Because this is the exact spot the automatic FK cascade fails, add a focused test (new file `src/app/(app)/settings/delete-context.test.ts` or extend an existing settings/db test) that: inserts a context, inserts a subscription with that `contextId`, calls the null-then-delete logic, and asserts the context row is gone AND the subscription's `contextId` is now `null` (not a throw). If the action's `revalidatePath` calls make it awkward to unit-test directly, extract the null-then-delete into a small tested helper in `src/lib/subscriptions.ts` (e.g. `deleteContextAndUnassign(id)`) and call it from the action.

- [ ] **Step 2: Add the `ContextsCard` UI**

In `src/components/settings-view.tsx`:

Add `Context` to the type import (line 20):

```ts
import type { Category, Context, PaymentMethod } from "@/db/schema";
```

Add the new actions to the settings-actions import (line 24-39 block), next to the category ones:

```ts
  addContext,
  updateContext,
  deleteContext,
```

Extend `SettingsView`'s props + render. Change the signature (lines 70-78) to add `contexts`, and render `<ContextsCard>` after `<CategoriesCard>` (line 90):

```tsx
export function SettingsView({
  settings,
  categories,
  contexts,
  paymentMethods,
}: {
  settings: AppSettings;
  categories: Category[];
  contexts: Context[];
  paymentMethods: PaymentMethod[];
}) {
```

```tsx
      <CategoriesCard categories={categories} />
      <ContextsCard contexts={contexts} />
      <PaymentMethodsCard paymentMethods={paymentMethods} />
```

Add these two components at the end of the file (after `PaymentMethodsCard`, line 808). They mirror `CategoriesCard`/`CategoryRow` exactly, swapping the entity:

```tsx
function ContextsCard({ contexts }: { contexts: Context[] }) {
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");

  function add() {
    if (!newName.trim()) return;
    start(async () => {
      const res = await addContext(newName, newColor);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Context added");
        setNewName("");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contexts</CardTitle>
        <CardDescription>
          Separate spending by area — e.g. Personal vs Work. Pick a context from
          the header to re-scope every total.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {contexts.map((c) => (
          <ContextRow key={c.id} context={c} />
        ))}

        <div className="flex items-center gap-2 pt-2">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent"
            aria-label="New context colour"
          />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New context…"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button onClick={add} disabled={pending} className="shrink-0 gap-1">
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ContextRow({ context }: { context: Context }) {
  const [name, setName] = useState(context.name);
  const [color, setColor] = useState(context.color);
  const [pending, start] = useTransition();
  const dirty = name !== context.name || color !== context.color;

  function save() {
    start(async () => {
      const res = await updateContext(context.id, name, color);
      if (res.error) toast.error(res.error);
      else toast.success("Context updated");
    });
  }
  function remove() {
    start(async () => {
      await deleteContext(context.id);
      toast.success("Context deleted");
    });
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent"
        aria-label={`${context.name} colour`}
      />
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      {dirty ? (
        <Button size="icon" onClick={save} disabled={pending} aria-label="Save">
          <Check className="size-4" />
        </Button>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        onClick={remove}
        disabled={pending}
        aria-label="Delete"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Pass contexts from the settings page**

Replace `src/app/(app)/settings/page.tsx`:

```tsx
import { SettingsView } from "@/components/settings-view";
import { getSettings } from "@/lib/settings";
import { getCategories, getContexts, getPaymentMethods } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <SettingsView
      settings={getSettings()}
      categories={getCategories()}
      contexts={getContexts()}
      paymentMethods={getPaymentMethods()}
    />
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/settings/actions.ts" src/components/settings-view.tsx "src/app/(app)/settings/page.tsx"
git commit -m "feat(settings): manage contexts (add/rename/recolor/delete)"
```

---

## Task 6: Assign context on the subscription form

**Files:**
- Modify: `src/app/(app)/subscriptions/actions.ts`
- Modify: `src/components/subscription-sheet.tsx`
- Modify: `src/components/subscriptions-view.tsx`
- Modify: `src/app/(app)/subscriptions/page.tsx`

**Interfaces:**
- Consumes: `optionalId` helper (existing), `getContexts()`, active filter.
- Produces: `contextId` persisted on save; `SubscriptionSheet` gains `contexts: Context[]` + `defaultContextId?: string`; card shows a context pill.

- [ ] **Step 1: Persist `contextId` in the save action**

In `src/app/(app)/subscriptions/actions.ts`, add `contextId` to `SubscriptionSchema` right after `categoryId` (line 70), reusing the existing `optionalId`:

```ts
  contextId: optionalId,
```

Add it to the `safeParse` object right after `categoryId` (line 121):

```ts
    contextId: formData.get("contextId"),
```

No other change — `values` now carries `contextId`, and both the insert and update paths spread `values`.

- [ ] **Step 2: Add the Context select to the sheet**

In `src/components/subscription-sheet.tsx`:

Add `Context` to the type import (line 6):

```ts
import type { Subscription, Category, Context, PaymentMethod } from "@/db/schema";
```

Extend `Props` (lines 51-58):

```ts
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  contexts: Context[];
  paymentMethods: PaymentMethod[];
  baseCurrency: string;
  subscription?: Subscription | null;
  /** Pre-selected context id ("none" if none) when adding while a context is active. */
  defaultContextId?: string;
};
```

Destructure the new props (lines 60-67): add `contexts,` and `defaultContextId = "none",`.

Add controlled state next to `categoryId` (after line 78):

```ts
  const [contextId, setContextId] = useState(
    subscription?.contextId
      ? String(subscription.contextId)
      : !subscription
        ? defaultContextId
        : "none",
  );
```

In the reset `useEffect` (after the `setCategoryId(...)` line, ~line 110), add:

```ts
    setContextId(
      subscription?.contextId
        ? String(subscription.contextId)
        : !subscription
          ? defaultContextId
          : "none",
    );
```

Add `defaultContextId` to that effect's dependency array (line 125): `}, [open, subscription, baseCurrency, defaultContextId]);`

Add the value→label map next to `categoryItems` (after line 182):

```ts
  const contextItems: Record<string, string> = {
    none: "None",
    ...Object.fromEntries(contexts.map((c) => [String(c.id), c.name])),
  };
```

Add the hidden input next to the categoryId one (after line 220):

```tsx
          <input type="hidden" name="contextId" value={contextId} />
```

Add the Context select. Replace the single-column "Website + Trial" row? No — instead add Context alongside Category. Change the Category/Payment grid (lines 442-483) so Context sits with them. Insert a new 2-col grid for Context immediately AFTER the Category/Payment `</div>` grid (after line 483):

```tsx
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Context</Label>
              <Select
                value={contextId}
                onValueChange={(v) => setContextId(v ?? "none")}
                items={contextItems}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {contexts.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div />
          </div>
```

- [ ] **Step 3: Pass contexts through the subscriptions view + render the pill**

In `src/components/subscriptions-view.tsx`:

Add `Context` to the type import (line 18):

```ts
import type { Category, Context, PaymentMethod, Subscription } from "@/db/schema";
```

Extend `Props` (lines 56-61):

```ts
type Props = {
  subscriptions: EnrichedSubscription[];
  categories: Category[];
  contexts: Context[];
  paymentMethods: PaymentMethod[];
  baseCurrency: string;
  defaultContextId?: string;
};
```

Destructure them (lines 111-116): add `contexts,` and `defaultContextId,`.

Pass them to the sheet (the `<SubscriptionSheet .../>` block, lines 431-438):

```tsx
      <SubscriptionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        categories={categories}
        contexts={contexts}
        paymentMethods={paymentMethods}
        baseCurrency={baseCurrency}
        subscription={editing}
        defaultContextId={defaultContextId}
      />
```

Render the context pill in the card meta footer. In the footer condition (line 406), include context, and add the pill after the category span (after line 416). Change the guard:

```tsx
                {sub.categoryName || sub.contextName || sub.paymentMethodName ? (
```

Add after the category `<span>…</span>` block (after line 416):

```tsx
                    {sub.contextName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: sub.contextColor ?? "#64748b" }}
                        />
                        {sub.contextName}
                      </span>
                    ) : null}
```

- [ ] **Step 4: Feed the page (contexts + active default)**

Replace `src/app/(app)/subscriptions/page.tsx`:

```tsx
import { SubscriptionsView } from "@/components/subscriptions-view";
import {
  listSubscriptions,
  getCategories,
  getContexts,
  getPaymentMethods,
} from "@/lib/subscriptions";
import { getBaseCurrency } from "@/lib/settings";
import { getActiveContextFilter } from "@/lib/contexts";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const filter = await getActiveContextFilter();
  const subscriptions = listSubscriptions(filter);
  const categories = getCategories();
  const contexts = getContexts();
  const paymentMethods = getPaymentMethods();
  const baseCurrency = getBaseCurrency();
  // When a context is active, new subs default to it.
  const defaultContextId = typeof filter === "number" ? String(filter) : "none";

  return (
    <SubscriptionsView
      subscriptions={subscriptions}
      categories={categories}
      contexts={contexts}
      paymentMethods={paymentMethods}
      baseCurrency={baseCurrency}
      defaultContextId={defaultContextId}
    />
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.
Run: `npm run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/subscriptions/actions.ts" src/components/subscription-sheet.tsx src/components/subscriptions-view.tsx "src/app/(app)/subscriptions/page.tsx"
git commit -m "feat(subscriptions): assign a context on the form + show it on the card"
```

---

## Task 7: Re-scope Dashboard & Calendar

**Files:**
- Modify: `src/app/(app)/page.tsx`
- Modify: `src/app/(app)/calendar/page.tsx`

**Interfaces:**
- Consumes: `getActiveContextFilter()`, `listSubscriptions(filter)`.

- [ ] **Step 1: Dashboard reads the active filter**

In `src/app/(app)/page.tsx`, add the import:

```ts
import { getActiveContextFilter } from "@/lib/contexts";
```

Make the component async and thread the filter (lines 45-49):

```tsx
export default async function DashboardPage() {
  const filter = await getActiveContextFilter();
  const subs = listSubscriptions(filter);
  const base = getBaseCurrency();
  const stats = computeDashboardStats(subs);
  const next = stats.upcoming[0];
```

The stat cards, category chart, and upcoming list all derive from `stats`/`subs`, so they re-scope automatically.

- [ ] **Step 2: Calendar reads the active filter**

Replace `src/app/(app)/calendar/page.tsx`:

```tsx
import { CalendarView } from "@/components/calendar-view";
import { listSubscriptions } from "@/lib/subscriptions";
import { getBaseCurrency } from "@/lib/settings";
import { getActiveContextFilter } from "@/lib/contexts";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const filter = await getActiveContextFilter();
  return (
    <CalendarView
      subscriptions={listSubscriptions(filter)}
      baseCurrency={getBaseCurrency()}
    />
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/page.tsx" "src/app/(app)/calendar/page.tsx"
git commit -m "feat(dashboard,calendar): re-scope to the active context"
```

---

## Task 8: Re-scope Reports (payments ledger)

**Files:**
- Modify: `src/lib/reports.ts`
- Modify: `src/app/(app)/reports/page.tsx`

**Interfaces:**
- Consumes: `subscriptionIdsForContext(filter)`, `ContextFilter` (Task 3), `listSubscriptions(filter)`.
- Produces: `getMonthlySpend(filter, months?, projectedMonths?)`, `getSpendTotals(filter)`.

- [ ] **Step 1: Filter the ledger queries by context**

In `src/lib/reports.ts`, update imports:

```ts
import { db } from "@/db";
import { payments } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { listSubscriptions } from "@/lib/subscriptions";
import { renewalsInRange, type BillingCycle } from "@/lib/billing";
import { subscriptionIdsForContext, type ContextFilter } from "@/lib/contexts";
```

Change `getMonthlySpend` (line 34) to accept the filter and scope both the past-charges query and the projection:

```ts
export function getMonthlySpend(
  filter: ContextFilter = "all",
  months = 12,
  projectedMonths = 3,
): MonthlySpend[] {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const ids = subscriptionIdsForContext(filter); // null = all
  // An active context with zero subs => no charges in scope.
  const scopedEmpty = ids !== null && ids.length === 0;

  // Past + current: sum recorded charges by month, scoped to the context.
  const byMonth = new Map<string, number>();
  if (!scopedEmpty) {
    const rows = db
      .select({ paidOn: payments.paidOn, amountBase: payments.amountBase })
      .from(payments)
      .where(ids === null ? undefined : inArray(payments.subscriptionId, ids))
      .all();
    for (const r of rows) {
      const key = r.paidOn.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + r.amountBase);
    }
  }
```

Keep the "past series" loop as-is. In the projection block (line 57), scope the subs to the same filter:

```ts
    const subs = listSubscriptions(filter).filter((s) => s.status === "active" && !s.free);
```

(the rest of the projection loop is unchanged.)

Change `getSpendTotals` (line 85):

```ts
export function getSpendTotals(
  filter: ContextFilter = "all",
): { allTime: number; thisYear: number } {
  const year = `${new Date().getFullYear()}-`;
  const ids = subscriptionIdsForContext(filter);
  if (ids !== null && ids.length === 0) return { allTime: 0, thisYear: 0 };

  let allTime = 0;
  let thisYear = 0;
  const rows = db
    .select({ paidOn: payments.paidOn, amountBase: payments.amountBase })
    .from(payments)
    .where(ids === null ? undefined : inArray(payments.subscriptionId, ids))
    .all();
  for (const r of rows) {
    allTime += r.amountBase;
    if (r.paidOn.startsWith(year)) thisYear += r.amountBase;
  }
  return { allTime: round2(allTime), thisYear: round2(thisYear) };
}
```

- [ ] **Step 2: Reports page reads the active filter**

In `src/app/(app)/reports/page.tsx`, add the import:

```ts
import { getActiveContextFilter } from "@/lib/contexts";
```

Make the component async and pass the filter (lines 41-45):

```tsx
export default async function ReportsPage() {
  const filter = await getActiveContextFilter();
  const base = getBaseCurrency();
  const monthly = getMonthlySpend(filter);
  const totals = getSpendTotals(filter);
  const year = new Date().getFullYear();
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/reports.ts "src/app/(app)/reports/page.tsx"
git commit -m "feat(reports): scope spend totals + monthly chart to the active context"
```

---

## Task 9: CSV import — optional Context column

**Files:**
- Modify: `src/lib/import-csv.ts`
- Modify: `src/lib/import-csv.test.ts`
- Modify: `src/app/(app)/settings/actions.ts`
- Modify: `src/components/settings-view.tsx`

**Interfaces:**
- Consumes: existing CSV parser, `ensureCat`/`ensurePm` pattern.
- Produces: `ParsedSubRow.contextName: string | null`; `Context` column in template + headers; `ImportPreview.newContexts: string[]`; import creates missing contexts.

- [ ] **Step 1: Write the failing parser test**

In `src/lib/import-csv.test.ts`, add a test that a `Context` column is parsed and that its absence yields `null`:

```ts
it("parses an optional Context column", () => {
  const csv = [
    "Name,Price,Currency,Billing cycle,Start date,Context",
    "Figma,12,USD,month,2024-01-01,Work",
    "Netflix,9.99,GBP,month,2024-01-01,",
  ].join("\n");
  const res = parseSubscriptionsCsv(csv, { baseCurrency: "GBP" });
  expect(res.ready).toHaveLength(2);
  expect(res.ready[0].contextName).toBe("Work");
  expect(res.ready[1].contextName).toBeNull();
});

it("defaults contextName to null when the column is absent", () => {
  const csv = ["Name,Price", "Spotify,9.99"].join("\n");
  const res = parseSubscriptionsCsv(csv, { baseCurrency: "GBP" });
  expect(res.ready[0].contextName).toBeNull();
});
```

(Ensure `parseSubscriptionsCsv` is imported at the top of the test file — it already is if other parser tests exist there.)

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/lib/import-csv.test.ts`
Expected: FAIL — `contextName` is undefined / not on `ParsedSubRow`.

- [ ] **Step 3: Implement the column**

In `src/lib/import-csv.ts`:

Add to `ParsedSubRow` (after `categoryName`, line 12):

```ts
  contextName: string | null;
```

Add to `SUBSCRIPTION_IMPORT_HEADERS` (after `"Category"`, line 37) — placement matters only for the template column order:

```ts
  "Context",
```

Add header aliases (after the `category` alias, line 61):

```ts
  context: "contextName",
```

In the `ready.push({...})` object (after `categoryName: ...`, line 243):

```ts
      contextName: get("contextName") || null,
```

Add the example cell to `buildImportTemplate` (line 256-259) so the example row stays aligned with headers — insert after the `"Streaming"` category cell:

```ts
  const example = [
    "Netflix", "15.99", "GBP", "month", "1", "2023-04-01",
    "", "Streaming", "Personal", "Credit Card", "no", "", "Family plan",
  ];
```

> The template builder emits `SUBSCRIPTION_IMPORT_HEADERS` then this example row; keep the example array in the same column order as the headers (Context now sits between Category and Payment method).

- [ ] **Step 4: Run parser tests to verify pass**

Run: `npx vitest run src/lib/import-csv.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Create missing contexts on import**

In `src/app/(app)/settings/actions.ts`:

Extend `ImportPreview` (line 206-213) with:

```ts
  newContexts: string[];
```

In `previewSubscriptionsCsv`, add an existing-contexts set (after `existingPms`, line 233):

```ts
  const existingCtxs = new Set(
    db.select({ name: contexts.name }).from(contexts).all().map((r) => lc(r.name)),
  );
```

Add a `newCtxs` map (next to `newCats`, line 238) and populate it in the row loop (after the category check, line 243):

```ts
  const newCtxs = new Map<string, string>();
```

```ts
    if (row.contextName && !existingCtxs.has(lc(row.contextName)))
      newCtxs.set(lc(row.contextName), row.contextName);
```

Add `newContexts` to the two `return` objects in `previewSubscriptionsCsv` (the headerError early-return, line 219, and the final return, line 248):

```ts
      newContexts: [],
```

```ts
    newContexts: [...newCtxs.values()],
```

In `importSubscriptionsCsv`, add a context map + `ensureCtx` inside the transaction (next to `pmMap`/`ensurePm`, after line 295):

```ts
      const ctxMap = new Map(
        tx.select().from(contexts).all().map((c) => [c.name.toLowerCase(), c.id]),
      );
      const ensureCtx = (name: string): number => {
        const key = name.toLowerCase();
        const found = ctxMap.get(key);
        if (found != null) return found;
        const id = Number(tx.insert(contexts).values({ name }).run().lastInsertRowid);
        ctxMap.set(key, id);
        return id;
      };
```

Add `contextId` to the inserted values (after `categoryId`, line 309):

```ts
            contextId: row.contextName ? ensureCtx(row.contextName) : null,
```

- [ ] **Step 6: Surface new contexts in the import dialog**

In `src/components/settings-view.tsx`, in the CSV confirm dialog, add a line mirroring "New categories" (after the `newCategories` block, line 338):

```tsx
            {csvConfirm && csvConfirm.preview.newContexts.length > 0 ? (
              <p className="text-muted-foreground">
                New contexts: {csvConfirm.preview.newContexts.join(", ")}
              </p>
            ) : null}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/import-csv.ts src/lib/import-csv.test.ts "src/app/(app)/settings/actions.ts" src/components/settings-view.tsx
git commit -m "feat(import): optional Context column, create-if-missing on CSV import"
```

---

## Task 10: Backup round-trip + CSV export column

**Files:**
- Modify: `src/lib/backup.ts`
- Modify: `src/lib/backup.test.ts`
- Modify: `src/lib/export.ts`
- Modify: `src/app/(app)/settings/actions.ts`

**Interfaces:**
- Produces: backup JSON includes `data.contexts` and `subscriptions[].contextId`; restore wipes+reloads `contexts`; subscriptions CSV export gains a `Context` column.

- [ ] **Step 1: Write the failing backup test**

In `src/lib/backup.test.ts`, add a case asserting a backup with contexts round-trips through `parseBackup` (mirror the existing valid-backup test shape; include a `contexts` array and a `contextId` on a subscription):

```ts
it("accepts a backup containing contexts", () => {
  const backup = {
    app: "squirrel",
    schema: 1,
    data: {
      settings: [],
      categories: [],
      contexts: [{ id: 1, name: "Work", color: "#0ea5e9" }],
      paymentMethods: [],
      subscriptions: [
        {
          id: 1, name: "Figma", logoUrl: null, url: null, price: 12,
          currencyCode: "USD", billingCycle: "month", billingInterval: 1,
          startDate: "2024-01-01", trialEndDate: null, categoryId: null,
          contextId: 1, paymentMethodId: null, notes: null, active: true,
          notify: true, free: false, cancelled: false, endsOn: null,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      payments: [],
    },
  };
  const res = parseBackup(JSON.stringify(backup));
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.data.data.contexts[0].name).toBe("Work");
    expect(res.data.data.subscriptions[0].contextId).toBe(1);
  }
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/lib/backup.test.ts`
Expected: FAIL — `contexts` is required-but-missing in the schema, or `contextId` isn't on `SubscriptionRow`.

- [ ] **Step 3: Add contexts to the backup schema**

In `src/lib/backup.ts`:

Add a `ContextRow` next to `CategoryRow` (after line 10):

```ts
const ContextRow = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string(),
});
```

Add `contextId` to `SubscriptionRow` (after `categoryId`, line 23):

```ts
  contextId: z.number().int().nullable(),
```

Add the `contexts` array to `BackupSchema.data` (after `categories`, line 52):

```ts
    contexts: z.array(ContextRow),
```

> Backward compatibility: an OLD backup (pre-contexts) has no `contexts` key and no `contextId`. To keep old backups restorable, make these tolerant: use `contexts: z.array(ContextRow).default([])` and `contextId: z.number().int().nullable().default(null)`. Prefer `.default(...)` over `.optional()` so downstream code always sees concrete values.

Apply the tolerant forms:

```ts
  contextId: z.number().int().nullable().default(null),
```

```ts
    contexts: z.array(ContextRow).default([]),
```

- [ ] **Step 4: Include contexts in export + restore**

In `src/lib/export.ts`, add `contexts` to the schema import (line 4-11 block) and to `buildBackup`'s `data` (after `categories`, line 31):

```ts
import {
  payments,
  subscriptions,
  categories,
  contexts,
  paymentMethods,
  settings,
} from "@/db/schema";
```

```ts
      categories: db.select().from(categories).all(),
      contexts: db.select().from(contexts).all(),
```

Add a Context column to `buildSubscriptionsCsv` — header (after `"Category"`, line 47) and row (after `s.categoryName ?? ""`, line 64):

```ts
    "Category",
    "Context",
```

```ts
    s.categoryName ?? "",
    s.contextName ?? "",
```

In `src/app/(app)/settings/actions.ts` `importBackup`, wipe + reload contexts inside the transaction. Delete contexts after categories (after line 176) and insert them before subscriptions (after the categories insert, line 179):

```ts
      tx.delete(payments).run();
      tx.delete(subscriptions).run();
      tx.delete(categories).run();
      tx.delete(contexts).run();
      tx.delete(paymentMethods).run();
      tx.delete(settings).run();
```

```ts
      if (d.categories.length) tx.insert(categories).values(d.categories).run();
      if (d.contexts.length) tx.insert(contexts).values(d.contexts).run();
```

> Order matters: `contexts` must be inserted before `subscriptions` because a sub's `context_id` FK references it. `foreign_keys = ON` is set (see `db/index.ts`).

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run src/lib/backup.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS (full suite).

- [ ] **Step 6: Commit**

```bash
git add src/lib/backup.ts src/lib/backup.test.ts src/lib/export.ts "src/app/(app)/settings/actions.ts"
git commit -m "feat(data): round-trip contexts through backup + CSV export"
```

---

## Task 11: Version bump, docs & release prep

**Files:**
- Modify: `package.json`
- Modify: `README.md` (usage section)

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "1.8.0"` → `"version": "1.9.0"`.

- [ ] **Step 2: Document the feature in the README**

Add a short "Contexts" subsection to the README usage docs (mirror the existing "Importing subscriptions" section style): explain that Personal/Work ship by default, are editable in Settings, assigned per subscription, and that the header switcher re-scopes Dashboard/Calendar/Reports; note that "All" combines everything and untagged subs appear under "Unassigned".

- [ ] **Step 3: Final full verification**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → PASS.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore: v1.9.0 — subscription contexts"
```

- [ ] **Step 5: Release (after merge to main — per AGENTS.md)**

> Not run inside the worktree branch. After this branch merges to `main`:
> 1. `git tag -a v1.9.0 -m "v1.9.0"` and push the tag (triggers the GHCR image build).
> 2. `gh release create v1.9.0 --verify-tag --title "v1.9.0" --notes "..." --latest` with the changelog in the notes body.
> Never leave a pushed tag without a GitHub Release.

---

## Manual smoke test (after Task 10, before release)

Run `npm run dev` and verify end-to-end:
1. Header shows a context switcher defaulting to **All contexts**.
2. Settings → Contexts lists **Personal** + **Work**; add "Side-project", recolor Work, rename it back.
3. Edit a sub → set Context = Work → card shows a Work pill.
4. Switch header to **Work** → Dashboard monthly/yearly totals, category chart, Calendar, and Reports all shrink to Work only. Switch to **Personal** → different totals. **All** → combined.
5. Add a sub while **Work** is active → the form pre-selects Work.
6. Switch to a context, delete it in Settings → the app falls back to **All** (no empty screen).
7. Export a backup, delete a context, restore the backup → contexts and their assignments come back.
8. Export subscriptions CSV → has a Context column. Re-import it → contexts are recreated.

---

## Self-review

**Spec coverage** (design doc §-by-§):
- Data model (contexts table, nullable context_id, index) → Task 1. ✅
- Seed Personal + Work → Task 1 (via `seedDefaults`, matching the codebase idiom — deviates from the doc's "seed in migration" note for consistency; behaviour identical). ✅
- Global switcher + cookie + re-scoping → Tasks 3, 4, 7, 8. ✅
- Filter semantics all / id / unassigned → Task 3 (`resolveContextFilter`) + used everywhere. ✅
- Reminders stay global → untouched; no task modifies `reminders.ts`/`scheduler.ts`. ✅ (verify: neither file appears in any task.)
- Assign on form + pre-select active + card pill → Task 6. ✅
- Settings CRUD + delete→NULL fallback → Task 5 (+ FK from Task 1). ✅
- Stale cookie → all → Task 3 tests; delete path relies on it (Task 5 note). ✅
- CSV import optional column → Task 9. ✅
- Backup/export round-trip → Task 10. ✅
- Out of scope: per-context reminder routing — correctly excluded. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — each mirrored component (ContextsCard, ensureCtx, etc.) is written out in full. ✅

**Type consistency:** `ContextFilter = number | "all" | "unassigned"` defined once (Task 3), imported as a type into `subscriptions.ts` (Task 2 note) and `reports.ts` (Task 8). `getContexts` returns `Context[]` everywhere. Cookie value strings `"all"|"unassigned"|"<id>"` consistent across `setActiveContext`, `resolveContextFilter`, and the switcher. `defaultContextId` is a string (`"none"` or `"<id>"`) in the page, view, and sheet. ✅

**Pre-confirmed against the repo:** `db:generate` script (Task 1) and `SelectSeparator` export (Task 4) both verified present — no fallbacks needed.
