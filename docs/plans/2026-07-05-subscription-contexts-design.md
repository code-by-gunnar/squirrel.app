# Subscription Contexts (Personal / Work) — Design

**Date:** 2026-07-05
**Status:** Approved, ready for implementation
**Target version:** v1.9.0

## Problem

Subscriptions span different areas of life — some are personal, some are paid for
work. Today they all sit in one undifferentiated list with one combined total.
The user wants to separate subscriptions by area (e.g. Personal vs Work) and see
totals that reflect only the selected area, without introducing multi-user
accounts.

## Decisions

- **Not a user/profile system.** The app is single-owner (one password, no user
  table). "Context" is a tag on a subscription, not an account.
- **Name:** `contexts` in code and **"Context"** in the UI. (Rejected "Profile" —
  it implies an account concept that doesn't exist here.)
- **Orthogonal to categories.** Category = *what kind of thing it is* (Streaming,
  Software). Context = *which area of life pays for it* (Personal, Work). A sub
  has both, independently. Netflix = Streaming + Personal; Copilot = Software +
  Work.
- **User-managed list**, seeded with `Personal` + `Work`, fully editable
  (add / rename / recolor / delete) — mirrors how `categories` already works.
- **Optional per subscription.** `context_id` is nullable, like `category_id`.
  Untagged subs show under "Unassigned" and always in the "All" view. No forced
  backfill of existing data.
- **Soft filter, not a hard workspace.** A global switcher re-scopes what you
  *see*; it never mutes reminders or mutates data.

## Data model

New table, mirroring `categories`:

```ts
export const contexts = sqliteTable("contexts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
});
```

New nullable column on `subscriptions`, mirroring `categoryId`:

```ts
contextId: integer("context_id").references(() => contexts.id, {
  onDelete: "set null",
}),
```

Plus `index("idx_subscriptions_context").on(t.contextId)`.

## Global context switcher & re-scoping

- A **Context switcher** lives in the header (`app-shell.tsx`), left of the theme
  toggle. Values: `All` (default), each context, and `Unassigned`.
- Selecting a value writes a cookie (`squirrel_context`) via a small server
  action, then `router.refresh()`.
- Each **server page** (`/`, `/calendar`, `/reports`, `/subscriptions`) reads the
  cookie and passes a filter into `listSubscriptions(contextId)`.
- `listSubscriptions` adds **one `WHERE` clause**. Everything downstream —
  `computeDashboardStats`, the category chart, Reports cashflow, the calendar —
  recomputes automatically off the already-filtered list. **No stats math
  changes.**

Filter semantics:

- `all` → no filter (combined total; today's behaviour).
- `<context id>` → only subs with that `context_id`.
- `unassigned` → only subs with `context_id IS NULL`.

**Reminders/notifications stay global** regardless of the switcher — the switcher
is a viewing lens, not a mute. A charge is a charge whichever context you're
viewing.

## Assigning a context

- **Subscription form** (`subscription-sheet.tsx`): a **Context** select beside
  the existing Category select. Optional (defaults to "None"). When adding a sub
  while a context is active in the switcher, that context is **pre-selected** as a
  default — overridable.
- **Subscription card** (`subscriptions-view.tsx`): a small context pill with its
  color dot in the existing meta footer, e.g. `● Streaming · ● Work · Visa ••1234`.
- **Settings** (`settings-view.tsx` + `actions.ts`): a **Contexts** section, a
  near-copy of the Categories manager — list with color swatches, add / rename /
  recolor / delete. Deleting a context sets its subs' `context_id` to NULL via the
  FK.
- The Subscriptions page keeps its existing per-page **category** filter as-is; no
  redundant per-page context dropdown (the header switcher handles context
  globally).

## Migration

`drizzle/0004_*.sql`, generated from the schema change:

1. `CREATE TABLE contexts`.
2. `ALTER TABLE subscriptions ADD COLUMN context_id INTEGER REFERENCES contexts(id)`.
3. `CREATE INDEX idx_subscriptions_context`.
4. Seed `Personal` and `Work` rows (in the migration, so it runs once on every
   existing install at upgrade — matching how schema changes ship).

Existing subs stay `context_id = NULL` → Unassigned / All. Zero forced backfill.

## Edge cases

- **Stale cookie** (context deleted while selected): if the cookie id matches no
  live context, fall back to `all`. Validate cookie is one of
  `{all, unassigned, <live id>}` on read.
- **Delete a context** → its subs become Unassigned; if it was the active
  switcher value, reset to `all`.
- **CSV import** (`import-csv.ts`): add an optional `context` column, matched by
  name (create-if-missing, like categories) or left NULL. Old CSVs without the
  column still import.
- **Backup / export** (`backup.ts`, `export.ts`): include `contexts` and
  `context_id` so backups round-trip.

## Testing (Vitest)

- `listSubscriptions(contextId)` filters correctly for a real id, `unassigned`,
  and `all`.
- Stats re-scope: Work total + Personal total + Unassigned total = All total
  (no double-count, no drops).
- Cookie validation: bad/stale id falls back to `all`.
- CSV import: matches existing context by name, creates missing, tolerates an
  absent column.

## Out of scope (YAGNI)

- **Per-context reminder routing** (e.g. Work renewals → a work ntfy topic).
  Notifications stay global. Revisit only if requested.
- Multi-user accounts / true workspaces.

## Affected files

- `src/db/schema.ts` — `contexts` table, `contextId` column, index.
- `drizzle/0004_*.sql` — migration + seed.
- `src/lib/subscriptions.ts` — `getContexts()`, `listSubscriptions(contextId?)`,
  enriched `contextName` / `contextColor`.
- `src/lib/contexts.ts` (or settings actions) — cookie read/validate helper.
- `src/components/app-shell.tsx` — header Context switcher.
- `src/app/(app)/page.tsx`, `calendar/page.tsx`, `reports/page.tsx`,
  `subscriptions/page.tsx` — read cookie, pass filter.
- `src/components/subscription-sheet.tsx` — Context select + save action.
- `src/app/(app)/subscriptions/actions.ts` — persist `contextId`.
- `src/components/subscriptions-view.tsx` — context pill on card.
- `src/components/settings-view.tsx` + `src/app/(app)/settings/actions.ts` —
  Contexts CRUD.
- `src/lib/import-csv.ts`, `src/lib/csv.ts` — optional `context` column.
- `src/lib/backup.ts`, `src/lib/export.ts` — round-trip contexts.
- Tests alongside each of the above.
