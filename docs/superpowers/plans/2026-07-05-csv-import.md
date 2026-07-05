# CSV Import (subscriptions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users bulk-import subscriptions from a CSV file (from another tracker or a spreadsheet), with a preview step, auto-created categories/payment methods, and backfilled payment history.

**Architecture:** A pure RFC-4180 `parseCsv` and a pure `parseSubscriptionsCsv` (header mapping + validation + defaults) — both unit-tested, no DB. Two server actions (`previewSubscriptionsCsv`, `importSubscriptionsCsv`) do the DB work: preview cross-references existing names; import runs one transaction (create missing categories/PMs, insert subs) then backfills payments best-effort. UI mirrors the existing JSON-restore file-picker + confirm-dialog pattern.

**Tech Stack:** Next.js 16 (App Router, server actions, route handlers), TypeScript, Drizzle/better-sqlite3 (synchronous transactions), Base UI (shadcn), vitest.

## Global Constraints

- **Version bump:** `package.json` `version` `1.7.0` → `1.8.0`.
- **Purity:** `src/lib/csv.ts` and `src/lib/import-csv.ts` (and their tests) must NOT import a `server-only` module — they stay pure so vitest can run them.
- **Scope:** subscriptions only. No payments-ledger import. Import **appends** (never replaces).
- **Only required column is `Name`.** All others have defaults: `Price`→0, `Currency`→instance base currency, `Billing cycle`→`month`, `Billing interval`→1, `Start date`→today (blank), `Free`→no.
- **Headers matched case-insensitively; unknown/computed columns ignored.** Our own export round-trips: when explicit `Billing cycle`/`Billing interval` columns are absent but a `Billing` column is present, derive cycle+interval from its prose (`"Monthly"`, `"Every 3 months"`).
- **Auto-create** missing categories/payment methods by name (case-insensitive) inside the import transaction.
- **Backfill** payment history per imported sub after the transaction, best-effort (a failure is logged, never aborts the import) — same contract as the create-subscription hook.
- **Skip-and-report** bad rows; valid rows still import. The import transaction covers valid rows only and is atomic.
- New subs default to `active: true, notify: true, cancelled: false`; `logoUrl` is left null.
- Test runner: `npx vitest run <file>` for one file; `npm test` for all.

---

### Task 1: Pure `parseCsv`

An RFC-4180 parser, the inverse of the existing `toCsv`.

**Files:**
- Modify: `src/lib/csv.ts` (add `parseCsv`)
- Test: `src/lib/csv.test.ts` (extend; create if missing)

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]`
- Consumes: nothing new (same file already exports `toCsv`).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/csv.test.ts` (if the file doesn't exist, create it with this content):

```ts
import { describe, it, expect } from "vitest";
import { toCsv, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("round-trips a toCsv document", () => {
    const csv = toCsv(["A", "B"], [["1", "two"], ["3", "four"]]);
    expect(parseCsv(csv)).toEqual([["A", "B"], ["1", "two"], ["3", "four"]]);
  });
  it("handles quoted fields with commas, quotes and newlines", () => {
    const csv = 'Name,Notes\r\n"A, Inc.","He said ""hi""\nsecond line"';
    expect(parseCsv(csv)).toEqual([
      ["Name", "Notes"],
      ["A, Inc.", 'He said "hi"\nsecond line'],
    ]);
  });
  it("accepts LF or CRLF line endings", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("ignores a trailing newline (no phantom empty row)", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps empty cells", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/csv.test.ts`
Expected: FAIL — `parseCsv` is not exported.

- [ ] **Step 3: Implement `parseCsv`**

Append to `src/lib/csv.ts`:

```ts
/**
 * Parse an RFC-4180 CSV document into rows of string cells. Handles quoted
 * fields (with embedded commas, newlines, and "" escaped quotes), CRLF or LF
 * line endings, and strips a leading UTF-8 BOM. A trailing newline does not
 * produce a phantom empty row. The inverse of `toCsv`.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue; // CR is skipped; the following LF ends the row
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush trailing content that wasn't terminated by a newline.
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  // Drop a trailing fully-empty row (e.g. from a final newline).
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/csv.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv.ts src/lib/csv.test.ts
git commit -m "feat(csv): add pure RFC-4180 parseCsv (inverse of toCsv)"
```

---

### Task 2: Pure `import-csv.ts` — parse/validate/map + template

The core import contract: turn CSV text into ready-to-insert rows + per-row errors.

**Files:**
- Create: `src/lib/import-csv.ts`
- Test: `src/lib/import-csv.test.ts`

**Interfaces:**
- Consumes: `parseCsv` (Task 1), `toCsv` (existing), `type BillingCycle` from `@/lib/billing`.
- Produces:
  - `type ParsedSubRow` (see code)
  - `type RowError = { line: number; name: string; reason: string }`
  - `type ParseResult = { ready: ParsedSubRow[]; skipped: RowError[]; headerError?: string }`
  - `parseSubscriptionsCsv(text: string, opts: { baseCurrency: string; today?: string }): ParseResult`
  - `const SUBSCRIPTION_IMPORT_HEADERS: readonly string[]`
  - `buildImportTemplate(): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/import-csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseSubscriptionsCsv,
  buildImportTemplate,
  SUBSCRIPTION_IMPORT_HEADERS,
} from "./import-csv";

const opts = { baseCurrency: "GBP", today: "2026-07-05" };

function csv(headers: string, ...rows: string[]) {
  return [headers, ...rows].join("\r\n");
}

describe("parseSubscriptionsCsv", () => {
  it("maps headers case-insensitively and in any order, ignoring extra columns", () => {
    const r = parseSubscriptionsCsv(
      csv("notes,NAME,price,Next renewal", "hi,Spotify,9.99,2026-08-01"),
      opts,
    );
    expect(r.skipped).toEqual([]);
    expect(r.ready).toHaveLength(1);
    expect(r.ready[0]).toMatchObject({ name: "Spotify", price: 9.99, notes: "hi" });
  });

  it("applies defaults for blank/missing columns", () => {
    const r = parseSubscriptionsCsv(csv("Name", "Netflix"), opts);
    expect(r.ready[0]).toMatchObject({
      name: "Netflix",
      price: 0,
      currencyCode: "GBP",
      billingCycle: "month",
      billingInterval: 1,
      startDate: "2026-07-05",
      free: false,
      categoryName: null,
      paymentMethodName: null,
    });
  });

  it("parses explicit cycle + interval and free/currency", () => {
    const r = parseSubscriptionsCsv(
      csv(
        "Name,Currency,Billing cycle,Billing interval,Free",
        "Domain,usd,year,2,yes",
      ),
      opts,
    );
    expect(r.ready[0]).toMatchObject({
      currencyCode: "USD",
      billingCycle: "year",
      billingInterval: 2,
      free: true,
    });
  });

  it("falls back to the export's prose Billing column", () => {
    const r = parseSubscriptionsCsv(
      csv("Name,Billing", "A,Every 3 months", "B,Weekly"),
      opts,
    );
    expect(r.ready[0]).toMatchObject({ billingCycle: "month", billingInterval: 3 });
    expect(r.ready[1]).toMatchObject({ billingCycle: "week", billingInterval: 1 });
  });

  it("strips currency symbols/separators from price", () => {
    const r = parseSubscriptionsCsv(csv("Name,Price", 'A,"£1,234.50"'), opts);
    expect(r.ready[0].price).toBe(1234.5);
  });

  it("skips bad rows with a line + reason but keeps good ones", () => {
    const r = parseSubscriptionsCsv(
      csv(
        "Name,Price,Start date,Billing cycle",
        "Good,5,2025-01-01,month",
        ",5,2025-01-01,month",
        "BadPrice,abc,2025-01-01,month",
        "BadDate,5,not-a-date,month",
        "BadCycle,5,2025-01-01,fortnight",
      ),
      opts,
    );
    expect(r.ready.map((x) => x.name)).toEqual(["Good"]);
    expect(r.skipped).toEqual([
      { line: 3, name: "", reason: "Missing name." },
      { line: 4, name: "BadPrice", reason: 'Invalid price "abc".' },
      { line: 5, name: "BadDate", reason: 'Invalid start date "not-a-date".' },
      { line: 6, name: "BadCycle", reason: 'Unknown billing cycle "fortnight".' },
    ]);
  });

  it("ignores fully-blank rows silently", () => {
    const r = parseSubscriptionsCsv(csv("Name,Price", "A,1", ",", "B,2"), opts);
    expect(r.ready.map((x) => x.name)).toEqual(["A", "B"]);
    expect(r.skipped).toEqual([]);
  });

  it("returns a headerError when there is no Name column", () => {
    const r = parseSubscriptionsCsv(csv("Foo,Bar", "1,2"), opts);
    expect(r.ready).toEqual([]);
    expect(r.headerError).toMatch(/Name/);
  });
});

describe("buildImportTemplate", () => {
  it("has the documented headers and one example row", () => {
    const lines = buildImportTemplate().split("\r\n");
    expect(lines[0]).toBe(SUBSCRIPTION_IMPORT_HEADERS.join(","));
    expect(lines[1]).toContain("Netflix");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/import-csv.test.ts`
Expected: FAIL — cannot resolve `./import-csv`.

- [ ] **Step 3: Implement `src/lib/import-csv.ts`**

```ts
import { parseCsv, toCsv } from "./csv";
import type { BillingCycle } from "./billing";

export type ParsedSubRow = {
  name: string;
  price: number;
  currencyCode: string;
  billingCycle: BillingCycle;
  billingInterval: number;
  startDate: string; // YYYY-MM-DD
  trialEndDate: string | null;
  categoryName: string | null;
  paymentMethodName: string | null;
  free: boolean;
  url: string | null;
  notes: string | null;
};

export type RowError = { line: number; name: string; reason: string };

export type ParseResult = {
  ready: ParsedSubRow[];
  skipped: RowError[];
  headerError?: string;
};

/** The canonical import columns (also the downloadable template header row). */
export const SUBSCRIPTION_IMPORT_HEADERS = [
  "Name",
  "Price",
  "Currency",
  "Billing cycle",
  "Billing interval",
  "Start date",
  "Trial end date",
  "Category",
  "Payment method",
  "Free",
  "URL",
  "Notes",
] as const;

// Normalized header text -> internal field key.
const HEADER_ALIASES: Record<string, string> = {
  name: "name",
  price: "price",
  amount: "price",
  cost: "price",
  currency: "currency",
  "currency code": "currency",
  "billing cycle": "cycle",
  cycle: "cycle",
  "billing interval": "interval",
  interval: "interval",
  billing: "billingProse", // export's human-readable column (fallback)
  "start date": "startDate",
  start: "startDate",
  "trial end date": "trialEndDate",
  "trial end": "trialEndDate",
  category: "categoryName",
  "payment method": "paymentMethodName",
  payment: "paymentMethodName",
  free: "free",
  url: "url",
  link: "url",
  notes: "notes",
  note: "notes",
};

const CYCLE_WORDS: Record<string, BillingCycle> = {
  day: "day", daily: "day", days: "day",
  week: "week", weekly: "week", weeks: "week",
  month: "month", monthly: "month", months: "month",
  year: "year", yearly: "year", years: "year", annual: "year", annually: "year",
};

function parseCycle(raw: string): BillingCycle | null {
  return CYCLE_WORDS[raw.trim().toLowerCase()] ?? null;
}

/** "Monthly" -> month/1 ; "Every 3 months" -> month/3 (mirrors describeCycle). */
function parseBillingProse(prose: string): { cycle: BillingCycle; interval: number } | null {
  const p = prose.trim().toLowerCase();
  if (!p) return null;
  const single: Record<string, BillingCycle> = {
    daily: "day", weekly: "week", monthly: "month", yearly: "year",
  };
  if (single[p]) return { cycle: single[p], interval: 1 };
  const m = p.match(/^every\s+(\d+)\s+(day|week|month|year)s?$/);
  if (m) return { cycle: CYCLE_WORDS[m[2]], interval: parseInt(m[1], 10) };
  return null;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/\//g, "-");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? null : iso;
}

function parseFree(raw: string): boolean {
  return /^(yes|true|1|free|y)$/i.test(raw.trim());
}

function parseCurrency(raw: string, base: string): string {
  const c = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : base;
}

/**
 * Parse a subscriptions CSV into ready-to-insert rows plus per-row errors.
 * Pure: no DB, no server-only. `today` is injectable for deterministic tests.
 */
export function parseSubscriptionsCsv(
  text: string,
  opts: { baseCurrency: string; today?: string },
): ParseResult {
  const grid = parseCsv(text);
  if (grid.length === 0) return { ready: [], skipped: [], headerError: "The file is empty." };

  const header = grid[0].map((h) => h.trim().toLowerCase());
  const colOf: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[h];
    if (key && !(key in colOf)) colOf[key] = i;
  });
  if (!("name" in colOf)) {
    return {
      ready: [],
      skipped: [],
      headerError: 'No "Name" column found. Download the template for the expected headers.',
    };
  }

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const ready: ParsedSubRow[] = [];
  const skipped: RowError[] = [];

  for (let r = 1; r < grid.length; r++) {
    const line = r + 1; // 1-based; header is line 1
    const cells = grid[r];
    const get = (key: string) => {
      const i = colOf[key];
      return i == null ? "" : (cells[i] ?? "").trim();
    };

    const name = get("name");
    if (!name) {
      if (cells.every((c) => c.trim() === "")) continue; // fully-blank row
      skipped.push({ line, name: "", reason: "Missing name." });
      continue;
    }

    let price = 0;
    const priceRaw = get("price");
    if (priceRaw) {
      const n = parseNumber(priceRaw);
      if (n == null) {
        skipped.push({ line, name, reason: `Invalid price "${priceRaw}".` });
        continue;
      }
      price = n;
    }

    let billingCycle: BillingCycle = "month";
    let billingInterval = 1;
    const cycleRaw = get("cycle");
    const intervalRaw = get("interval");
    const proseRaw = get("billingProse");
    if (cycleRaw) {
      const c = parseCycle(cycleRaw);
      if (!c) {
        skipped.push({ line, name, reason: `Unknown billing cycle "${cycleRaw}".` });
        continue;
      }
      billingCycle = c;
      if (intervalRaw) {
        const iv = parseInt(intervalRaw, 10);
        if (!Number.isFinite(iv) || iv < 1) {
          skipped.push({ line, name, reason: `Invalid billing interval "${intervalRaw}".` });
          continue;
        }
        billingInterval = iv;
      }
    } else if (proseRaw) {
      const parsed = parseBillingProse(proseRaw);
      if (!parsed) {
        skipped.push({ line, name, reason: `Couldn't read billing "${proseRaw}".` });
        continue;
      }
      billingCycle = parsed.cycle;
      billingInterval = parsed.interval;
    }

    let startDate = today;
    const startRaw = get("startDate");
    if (startRaw) {
      const d = parseDate(startRaw);
      if (!d) {
        skipped.push({ line, name, reason: `Invalid start date "${startRaw}".` });
        continue;
      }
      startDate = d;
    }

    let trialEndDate: string | null = null;
    const trialRaw = get("trialEndDate");
    if (trialRaw) {
      const d = parseDate(trialRaw);
      if (!d) {
        skipped.push({ line, name, reason: `Invalid trial end date "${trialRaw}".` });
        continue;
      }
      trialEndDate = d;
    }

    ready.push({
      name,
      price,
      currencyCode: parseCurrency(get("currency"), opts.baseCurrency),
      billingCycle,
      billingInterval,
      startDate,
      trialEndDate,
      categoryName: get("categoryName") || null,
      paymentMethodName: get("paymentMethodName") || null,
      free: parseFree(get("free")),
      url: get("url") || null,
      notes: get("notes") || null,
    });
  }

  return { ready, skipped };
}

/** The downloadable blank template: header row + one example row. */
export function buildImportTemplate(): string {
  const example = [
    "Netflix", "15.99", "GBP", "month", "1", "2023-04-01",
    "", "Streaming", "Credit Card", "no", "", "Family plan",
  ];
  return toCsv([...SUBSCRIPTION_IMPORT_HEADERS], [example]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/import-csv.test.ts`
Expected: PASS (all cases). Then `npx tsc --noEmit` — Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import-csv.ts src/lib/import-csv.test.ts
git commit -m "feat(import): pure CSV subscription parser + template builder"
```

---

### Task 3: Template route + preview/import server actions

The DB layer. No new unit tests (server-only IO; the parser is covered by Task 2) — gated by typecheck.

**Files:**
- Create: `src/app/api/export/subscriptions-template/route.ts`
- Modify: `src/app/(app)/settings/actions.ts`

**Interfaces:**
- Consumes: `parseSubscriptionsCsv`, `RowError` (Task 2); `backfillPayments` from `@/lib/payments`; `getBaseCurrency` from `@/lib/settings`; `buildImportTemplate` (Task 2).
- Produces:
  - `type ImportPreview = { ready: number; skipped: RowError[]; duplicateNames: string[]; newCategories: string[]; newPaymentMethods: string[]; headerError?: string }`
  - `previewSubscriptionsCsv(text: string): Promise<ImportPreview>`
  - `importSubscriptionsCsv(text: string): Promise<ActionState & { inserted?: number; skipped?: number }>`

- [ ] **Step 1: Create the template route**

Create `src/app/api/export/subscriptions-template/route.ts`:

```ts
import { buildImportTemplate } from "@/lib/import-csv";

export const dynamic = "force-dynamic";

// UTF-8 BOM so Excel opens it cleanly (matches the export routes).
const BOM = String.fromCharCode(0xfeff);

export function GET() {
  return new Response(BOM + buildImportTemplate(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="squirrel-import-template.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Add imports to `settings/actions.ts`**

At the top of `src/app/(app)/settings/actions.ts`, add:

```ts
import { getBaseCurrency } from "@/lib/settings";
import { parseSubscriptionsCsv, type RowError } from "@/lib/import-csv";
import { backfillPayments } from "@/lib/payments";
```

(The file already imports `db`, `categories`, `paymentMethods`, `subscriptions`, `revalidatePath`, `getSettings`, and `type ActionState`. Add `getBaseCurrency` to the existing `@/lib/settings` import rather than duplicating it.)

- [ ] **Step 3: Add the preview action**

Append to `src/app/(app)/settings/actions.ts`:

```ts
export type ImportPreview = {
  ready: number;
  skipped: RowError[];
  duplicateNames: string[];
  newCategories: string[];
  newPaymentMethods: string[];
  headerError?: string;
};

/** Parse + validate an uploaded CSV and cross-reference existing names. No writes. */
export async function previewSubscriptionsCsv(text: string): Promise<ImportPreview> {
  const base = getBaseCurrency();
  const parsed = parseSubscriptionsCsv(text, { baseCurrency: base });
  if (parsed.headerError) {
    return {
      ready: 0, skipped: [], duplicateNames: [],
      newCategories: [], newPaymentMethods: [], headerError: parsed.headerError,
    };
  }

  const lc = (s: string) => s.toLowerCase();
  const existingSubs = new Set(
    db.select({ name: subscriptions.name }).from(subscriptions).all().map((r) => lc(r.name)),
  );
  const existingCats = new Set(
    db.select({ name: categories.name }).from(categories).all().map((r) => lc(r.name)),
  );
  const existingPms = new Set(
    db.select({ name: paymentMethods.name }).from(paymentMethods).all().map((r) => lc(r.name)),
  );

  const duplicateNames: string[] = [];
  const newCats = new Map<string, string>();
  const newPms = new Map<string, string>();
  for (const row of parsed.ready) {
    if (existingSubs.has(lc(row.name))) duplicateNames.push(row.name);
    if (row.categoryName && !existingCats.has(lc(row.categoryName)))
      newCats.set(lc(row.categoryName), row.categoryName);
    if (row.paymentMethodName && !existingPms.has(lc(row.paymentMethodName)))
      newPms.set(lc(row.paymentMethodName), row.paymentMethodName);
  }

  return {
    ready: parsed.ready.length,
    skipped: parsed.skipped,
    duplicateNames,
    newCategories: [...newCats.values()],
    newPaymentMethods: [...newPms.values()],
  };
}
```

- [ ] **Step 4: Add the import action**

Append to `src/app/(app)/settings/actions.ts`:

```ts
/**
 * Import valid rows from a CSV as new subscriptions. Appends (never replaces).
 * Missing categories/payment methods are created inside the transaction; payment
 * history is backfilled per sub afterwards (best-effort; a backfill failure is
 * logged and never rolls back the import). Re-parses the text server-side.
 */
export async function importSubscriptionsCsv(
  text: string,
): Promise<ActionState & { inserted?: number; skipped?: number }> {
  const base = getBaseCurrency();
  const parsed = parseSubscriptionsCsv(text, { baseCurrency: base });
  if (parsed.headerError) return { error: parsed.headerError };
  if (parsed.ready.length === 0) return { error: "No valid rows to import." };

  const newIds: number[] = [];
  try {
    db.transaction((tx) => {
      const catMap = new Map(
        tx.select().from(categories).all().map((c) => [c.name.toLowerCase(), c.id]),
      );
      const pmMap = new Map(
        tx.select().from(paymentMethods).all().map((p) => [p.name.toLowerCase(), p.id]),
      );
      const ensureCat = (name: string): number => {
        const key = name.toLowerCase();
        const found = catMap.get(key);
        if (found != null) return found;
        const id = Number(tx.insert(categories).values({ name }).run().lastInsertRowid);
        catMap.set(key, id);
        return id;
      };
      const ensurePm = (name: string): number => {
        const key = name.toLowerCase();
        const found = pmMap.get(key);
        if (found != null) return found;
        const id = Number(tx.insert(paymentMethods).values({ name }).run().lastInsertRowid);
        pmMap.set(key, id);
        return id;
      };

      for (const row of parsed.ready) {
        const info = tx
          .insert(subscriptions)
          .values({
            name: row.name,
            url: row.url,
            price: row.price,
            currencyCode: row.currencyCode,
            billingCycle: row.billingCycle,
            billingInterval: row.billingInterval,
            startDate: row.startDate,
            trialEndDate: row.trialEndDate,
            categoryId: row.categoryName ? ensureCat(row.categoryName) : null,
            paymentMethodId: row.paymentMethodName ? ensurePm(row.paymentMethodName) : null,
            notes: row.notes,
            free: row.free,
            active: true,
            notify: true,
            cancelled: false,
          })
          .run();
        newIds.push(Number(info.lastInsertRowid));
      }
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Import failed" };
  }

  // Backfill outside the transaction (makes network FX calls). Best-effort.
  for (const id of newIds) {
    try {
      await backfillPayments(id);
    } catch (e) {
      console.error("[squirrel] import backfill failed", e);
    }
  }

  revalidatePath("/");
  revalidatePath("/subscriptions");
  revalidatePath("/calendar");
  revalidatePath("/reports");
  revalidatePath("/settings");
  return { ok: true, inserted: newIds.length, skipped: parsed.skipped.length };
}
```

- [ ] **Step 5: Verify typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all existing + Task 1/2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/export/subscriptions-template/route.ts" "src/app/(app)/settings/actions.ts"
git commit -m "feat(import): template route + preview/import server actions"
```

---

### Task 4: Data-card UI

Add the import button, template link, and preview dialog to the Data card, mirroring the JSON-restore flow.

**Files:**
- Modify: `src/components/settings-view.tsx`

**Interfaces:**
- Consumes: `previewSubscriptionsCsv`, `importSubscriptionsCsv`, `type ImportPreview` (Task 3).

- [ ] **Step 1: Add imports**

In `src/components/settings-view.tsx`, add to the existing action import block (the one that already imports `importBackup`):

```ts
  previewSubscriptionsCsv,
  importSubscriptionsCsv,
  type ImportPreview,
```

(`Upload`, `Download`, `LoaderCircle`, `useRef`, `useState`, `useTransition`, `useRouter`, `toast`, and the `Dialog`/`Button` components are already imported.)

- [ ] **Step 2: Add CSV import state + handlers in `DataCard`**

Inside `function DataCard()`, after the existing `confirm` state (`useState<{ text; subs; payments } | null>`), add:

```ts
  const csvFileRef = useRef<HTMLInputElement>(null);
  const [csvConfirm, setCsvConfirm] = useState<{ text: string; preview: ImportPreview } | null>(null);
  const [importing, startImport] = useTransition();

  async function onPickCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    const text = await file.text();
    const preview = await previewSubscriptionsCsv(text);
    if (preview.headerError) {
      toast.error(preview.headerError);
      return;
    }
    if (preview.ready === 0 && preview.skipped.length === 0) {
      toast.error("No rows found in that file.");
      return;
    }
    setCsvConfirm({ text, preview });
  }

  function runImport() {
    if (!csvConfirm) return;
    const text = csvConfirm.text;
    startImport(async () => {
      const res = await importSubscriptionsCsv(text);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      const skipped = res.skipped ? ` ${res.skipped} row(s) skipped.` : "";
      toast.success(`Imported ${res.inserted ?? 0} subscription(s).${skipped}`);
      setCsvConfirm(null);
      router.refresh();
    });
  }
```

- [ ] **Step 3: Add the import sub-section to the card body**

In `DataCard`'s JSX, immediately after the first export-buttons `<div className="flex flex-col gap-3 sm:flex-row"> … Subscriptions (.csv) … </div>` closes (right before the `<div className="border-t pt-5">` that starts the JSON backup block), insert:

```tsx
        <div className="border-t pt-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Import subscriptions from a CSV — coming from another tracker or a
            spreadsheet. Missing categories and payment methods are created
            automatically, and past charges are backfilled.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => csvFileRef.current?.click()}
            >
              <Upload className="size-4" />
              Import subscriptions (.csv)
            </Button>
            <Button
              render={<a href="/api/export/subscriptions-template" download />}
              nativeButton={false}
              variant="outline"
              className="justify-start gap-2"
            >
              <Download className="size-4" />
              Download template
            </Button>
            <input
              ref={csvFileRef}
              type="file"
              accept="text/csv,.csv"
              className="hidden"
              onChange={onPickCsv}
            />
          </div>
        </div>
```

- [ ] **Step 4: Add the preview dialog**

Immediately after the existing restore `<Dialog>…</Dialog>` (before the closing `</Card>`), add:

```tsx
      <Dialog
        open={csvConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !importing) setCsvConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import subscriptions?</DialogTitle>
            <DialogDescription>
              {csvConfirm?.preview.ready ?? 0} subscription
              {csvConfirm?.preview.ready === 1 ? "" : "s"} ready to import. This adds
              to your existing data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {csvConfirm && csvConfirm.preview.newCategories.length > 0 ? (
              <p className="text-muted-foreground">
                New categories: {csvConfirm.preview.newCategories.join(", ")}
              </p>
            ) : null}
            {csvConfirm && csvConfirm.preview.newPaymentMethods.length > 0 ? (
              <p className="text-muted-foreground">
                New payment methods: {csvConfirm.preview.newPaymentMethods.join(", ")}
              </p>
            ) : null}
            {csvConfirm && csvConfirm.preview.duplicateNames.length > 0 ? (
              <p className="text-amber-600">
                {csvConfirm.preview.duplicateNames.length} name(s) already exist and
                will be added again.
              </p>
            ) : null}
            {csvConfirm && csvConfirm.preview.skipped.length > 0 ? (
              <details className="text-muted-foreground">
                <summary className="cursor-pointer">
                  {csvConfirm.preview.skipped.length} row(s) will be skipped
                </summary>
                <ul className="mt-2 space-y-1">
                  {csvConfirm.preview.skipped.slice(0, 10).map((s) => (
                    <li key={s.line}>
                      Line {s.line}
                      {s.name ? ` (${s.name})` : ""}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCsvConfirm(null)} disabled={importing}>
              Cancel
            </Button>
            <Button
              onClick={runImport}
              disabled={importing || (csvConfirm?.preview.ready ?? 0) === 0}
            >
              {importing ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Importing…
                </>
              ) : (
                `Import ${csvConfirm?.preview.ready ?? 0}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: compiles; no unused-symbol lint errors.

- [ ] **Step 6: Manual E2E (dev server)**

Run `npm run dev`, open `/settings` → Data card:
1. **Download template** → file has the documented headers + the Netflix example row.
2. Create a CSV with a header row and: a normal GBP monthly sub, a `USD`/`year`/`2` sub, a row with a new `Category` ("Gaming Pass"), a `Free` row, and one broken row (e.g. bad date). **Import subscriptions (.csv)** → preview dialog shows the right ready count, "New categories: Gaming Pass", and 1 skipped row with its reason.
3. Confirm → toast "Imported N…", the subs appear on `/subscriptions`, the new category exists, the broken row is absent, and `/reports` shows backfilled spend for the past-dated subs.
4. Export your subscriptions CSV, then re-import that exact file → it round-trips (prose `Billing` parsed, computed columns ignored).
5. Import a file with no `Name` column → error toast, nothing written.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings-view.tsx
git commit -m "feat(import): CSV import UI — template, preview dialog, wiring"
```

---

### Task 5: Version bump + README

**Files:**
- Modify: `package.json`, `README.md`

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "1.7.0"` to `"version": "1.8.0"`.

- [ ] **Step 2: Update the README**

In `README.md`, update the **Export & backup** feature bullet to mention import. Find:

```
- **Export & backup** — download your payment history and subscriptions as CSV
  for spreadsheets or tax, or take a full JSON backup and restore it onto any
  Squirrel instance (a one-click, atomic replace). Your data, portable.
```

Replace with:

```
- **Import, export & backup** — bulk-**import** subscriptions from a CSV (coming
  from another tracker or a spreadsheet) with a preview step, auto-created
  categories/payment methods and backfilled history; **export** your payment
  history and subscriptions as CSV for spreadsheets or tax; or take a full JSON
  backup and restore it onto any Squirrel instance (a one-click, atomic replace).
  Your data, portable.
```

(If the exact bullet wording differs, keep the sentence's spirit and just add the import clause at the front.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds; footer shows 1.8.0.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "feat(import): CSV subscription import; docs + v1.8.0"
```

---

## Self-Review Notes

- **Spec coverage:** lenient defined-template format + round-trip prose fallback (T2); required-`Name`-only + defaults (T2); auto-create categories/PMs (T3); backfill history best-effort (T3); append (T3); preview→confirm (T3/T4); template download (T2/T3/T4); `parseCsv` + `import-csv.ts` pure split (T1/T2); tests (T1/T2); version + README (T5) — all mapped.
- **Type consistency:** `ParsedSubRow` / `RowError` / `ParseResult` defined T2, consumed T3. `ImportPreview` defined T3, consumed T4. `parseSubscriptionsCsv(text, {baseCurrency, today?})` signature identical across T2/T3. `backfillPayments(id)` matches `@/lib/payments`.
- **Purity:** T1/T2 import only `./csv`, `./billing` (types) — no `server-only`; vitest-safe.
- **Deviation from spec:** validation is imperative (per-field, producing precise `line + reason` messages) rather than zod — the spec mentioned zod, but imperative parsing yields better import-error UX and avoids fighting zod over transform-with-defaults. Behavior/outputs are unchanged.
- **FK safety:** the import transaction inserts categories/PMs before the subscriptions that reference them and resolves real ids, so FKs are valid even though the FK pragma is inert inside a transaction.
