# CSV Import (subscriptions)

**Date:** 2026-07-05
**Status:** Approved (design)
**Version target:** 1.7.0 → 1.8.0

## Context

Squirrel can export subscriptions and payments as CSV (v1.5.0) and take a full
JSON backup/restore (v1.6.0), but there is no way to **bulk-import** subscriptions.
A new user's only options today are starting from zero or re-entering years of
subscriptions by hand. People arriving from another tracker, or who keep their
subs in a spreadsheet, should be able to import them in one shot.

This adds **CSV import for subscriptions** — the counterpart to the existing
export — built around a documented, lenient column format with a preview step
before anything is written.

## Scope

**In scope:** importing subscriptions from a CSV file.

**Out of scope (deliberately):**
- Importing the **payments ledger**. Ledger rows carry an FX rate snapshotted at
  charge time; they can't be faithfully reconstructed from a user's arbitrary CSV.
  Instead, imported subscriptions get their history **backfilled** from their
  start date using our own FX data (see "Behavior").
- A full column-mapping UI. The lenient fixed template covers spreadsheets and
  other-tracker exports without that complexity (YAGNI).
- Replace/merge semantics. Import **appends**; whole-database replacement already
  exists via JSON restore.

## Import format

A documented set of columns, matched **case-insensitively** (header trimmed).
Unknown columns are ignored, so our own report-style export round-trips and messy
spreadsheets still work.

| Column | Required | Default | Notes |
|--------|----------|---------|-------|
| `Name` | **yes** | — | non-empty; the only hard requirement |
| `Price` | no | `0` | parsed as a number; currency symbols/thousands separators stripped |
| `Currency` | no | base currency | 3-letter code, upper-cased; falls back to the instance base currency |
| `Billing cycle` | no | `month` | one of `day` / `week` / `month` / `year` (case-insensitive; also accepts `daily`/`weekly`/`monthly`/`yearly`) |
| `Billing interval` | no | `1` | positive integer ("every N cycles") |
| `Start date` | no | today | ISO `YYYY-MM-DD`; also accepts `YYYY/MM/DD`. Blank ⇒ today |
| `Trial end date` | no | none | ISO date or blank |
| `Category` | no | none | matched by name (case-insensitive); created if absent |
| `Payment method` | no | none | matched by name (case-insensitive); created if absent |
| `Free` | no | `no` | truthy = `yes`/`true`/`1`/`free` (case-insensitive) |
| `URL` | no | none | |
| `Notes` | no | none | |

**Round-trip fallback.** Our export writes a single human-readable `Billing`
column (`describeCycle`: `"Monthly"`, `"Yearly"`, `"Every 3 months"`, …) and no
explicit interval. When `Billing cycle` / `Billing interval` columns are absent
but a `Billing` column is present, the parser derives cycle + interval from that
prose (`"Weekly"` ⇒ week/1, `"Every 3 months"` ⇒ month/3). The export's computed
columns (`Next renewal`, `Monthly (base)`, `Yearly (base)`, `Status`) are ignored
on import.

**Template.** A **Download template (.csv)** action provides a file with the
header row above plus one example data row (e.g. `Netflix,15.99,GBP,month,1,
2023-04-01,,Streaming,Credit Card,no,,Family plan`), so users have an exact target
to fill in.

## Behavior

- **Append.** Each valid row becomes a new subscription. Existing data is untouched.
- **Auto-resolve references.** `Category` and `Payment method` are matched by name
  (case-insensitive) against existing rows; any not found are **created** as part
  of the same import transaction, then linked.
- **Backfill history.** After inserting a subscription, its payment ledger is
  backfilled from `Start date` to today (reusing `backfillPayments` + FX), so
  Reports and totals are correct immediately — the core value for a multi-year
  import. Backfill is best-effort per sub (a failure is logged, never aborts the
  import), matching the existing create-subscription hook.
- **Duplicates are not merged.** Rows whose `Name` already exists are still
  imported; the preview surfaces the collision count as a heads-up so the user can
  fix their file and re-import if they didn't intend it.
- **New subscriptions default to** `active: true`, `notify: true`, `cancelled:
  false` (status columns from the export are ignored). `Free` maps to the `free`
  flag.

## Preview → confirm

Import never writes on the first click. Flow:

1. User picks a `.csv` file (hidden `<input type="file" accept=".csv">`).
2. The file text is sent to `previewSubscriptionsCsv(text)`, which parses +
   validates (no writes) and checks existing names, returning a summary:
   `{ ready, skipped: [{ line, name, reason }], duplicateNames, newCategories,
   newPaymentMethods }`.
3. A confirm **Dialog** shows: *"X subscriptions ready to import"*, the count of
   skipped rows (expandable list with per-row reasons), how many names already
   exist, and which categories/payment methods will be created.
4. On confirm, `importSubscriptionsCsv(text)` re-parses and performs the import in
   a single `db.transaction` (valid rows only), then backfills payments and
   revalidates. Returns `{ ok, inserted, skipped }`.

Re-parsing on confirm (rather than trusting a client-passed parsed payload) keeps
the server action self-contained and the trust boundary clean, consistent with
`importBackup`.

## Architecture

Mirrors the existing pure-logic / server-only split (billing, currency, csv,
backup are pure and unit-tested; `import "server-only"` modules do IO).

- **`src/lib/csv.ts`** — add a pure **`parseCsv(text: string): string[][]`**
  (RFC-4180: quoted fields, escaped `""` quotes, embedded commas and newlines,
  CRLF or LF, a leading UTF-8 BOM stripped). Complements the existing `toCsv`.
- **`src/lib/import-csv.ts`** (new, **pure**) — the import contract:
  - `type ParsedSubRow` — a validated, ready-to-insert subscription shape
    (`name`, `price`, `currencyCode`, `billingCycle`, `billingInterval`,
    `startDate`, `trialEndDate`, `categoryName`, `paymentMethodName`, `free`,
    `url`, `notes`).
  - `type RowError = { line: number; name: string; reason: string }`.
  - `parseSubscriptionsCsv(text, opts: { baseCurrency: string }):
    { ready: ParsedSubRow[]; skipped: RowError[]; headerError?: string }` —
    runs `parseCsv`, maps headers (case-insensitive + the prose-`Billing`
    fallback), validates each row with zod, applies defaults, and collects
    per-row errors. Pure (no db, no `server-only`) ⇒ fully unit-testable.
  - `SUBSCRIPTION_IMPORT_HEADERS` + `buildImportTemplate(): string` — the
    canonical header list and the downloadable template string (reuses `toCsv`).
- **`src/app/(app)/settings/actions.ts`** — two server actions:
  - `previewSubscriptionsCsv(text)` → resolves `baseCurrency`, calls the pure
    parser, cross-references existing category / payment-method / subscription
    names, returns the summary object (no writes).
  - `importSubscriptionsCsv(text)` → parser again, then a single `db.transaction`:
    create any missing categories / payment methods, insert the `ready` rows with
    resolved FK ids; after the transaction, backfill payments per new sub
    (best-effort) and `revalidatePath` for `/`, `/subscriptions`, `/calendar`,
    `/reports`, `/settings`. Returns `{ ok, inserted, skipped }`.
- **`src/app/api/export/subscriptions-template/route.ts`** (new) — `GET` returns
  `buildImportTemplate()` as an attachment (`squirrel-import-template.csv`),
  mirroring the existing export routes (auth-gated by `proxy.ts`).
- **`src/components/settings-view.tsx`** — extend the Data card: an **Import
  subscriptions (CSV)** button (hidden file input → `previewSubscriptionsCsv` →
  confirm Dialog → `importSubscriptionsCsv` in `useTransition` → toast +
  `router.refresh()`), and a **Download template** link (`<Button render={<a
  href download />}>`, same pattern as the export buttons). Reuses the existing
  Dialog + file-input pattern from JSON restore.

## Testing

- **Unit — `src/lib/csv.test.ts`** (extend): `parseCsv` round-trips `toCsv`;
  quoted fields containing commas, quotes (`""`), and newlines; CRLF and LF;
  leading BOM; trailing newline; ragged rows.
- **Unit — `src/lib/import-csv.test.ts`** (new): header mapping (case-insensitive,
  reordered columns, extra ignored columns); defaults applied (blank price ⇒ 0,
  blank currency ⇒ base, blank start ⇒ today, blank cycle ⇒ month/1); the prose
  `Billing` fallback (`"Every 3 months"` ⇒ month/3); `Free` truthiness; error rows
  collected with line + reason (missing name, non-numeric price, bad date,
  unknown cycle) while valid rows still come through; a missing-`Name`-column file
  returns a `headerError`.
- **Build:** `npm run build` typechecks the new actions, route, and UI.
- **E2E (dev server + Playwright):**
  1. Download the template → it has the documented headers.
  2. Import a small CSV (mix of currencies, a 3-month cycle, a new category, a
     `Free` row, and one deliberately-broken row) → preview shows correct ready /
     skipped / new-category counts → confirm → subscriptions appear, the new
     category exists, the broken row is absent, and Reports shows backfilled spend.
  3. Import our own exported subscriptions CSV → round-trips (prose `Billing`
     parsed, computed columns ignored), correct count.
  4. A file with no `Name` column → clear header error, nothing written.

## Rollout

1. Pure `parseCsv` + tests.
2. Pure `import-csv.ts` (parse/validate/map/template) + tests.
3. Template route + Download button.
4. Preview + import server actions (transaction, auto-create, backfill).
5. Data-card UI (file input, preview dialog, wiring).
6. Version bump 1.8.0; README "Import" note under Export & backup.

## Files

**Create:** `src/lib/import-csv.ts`, `src/lib/import-csv.test.ts`,
`src/app/api/export/subscriptions-template/route.ts`.

**Modify:** `src/lib/csv.ts` (add `parseCsv`), `src/lib/csv.test.ts`,
`src/app/(app)/settings/actions.ts` (two actions), `src/components/settings-view.tsx`
(Data card), `package.json` (version), `README.md` (import note).
