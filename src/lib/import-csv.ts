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
    annual: "year", annually: "year",
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
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const iso = `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  // Reject calendar rollovers (e.g. 2025-02-30 -> Mar 2): the parsed date must
  // round-trip to the same year/month/day.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== mo || dt.getUTCDate() !== d) {
    return null;
  }
  return iso;
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
        if (!/^\d+$/.test(intervalRaw) || parseInt(intervalRaw, 10) < 1) {
          skipped.push({ line, name, reason: `Invalid billing interval "${intervalRaw}".` });
          continue;
        }
        billingInterval = parseInt(intervalRaw, 10);
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
