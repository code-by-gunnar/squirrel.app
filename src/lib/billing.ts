import { addDays, addWeeks, addMonths, addYears, differenceInCalendarDays } from "date-fns";

export type BillingCycle = "day" | "week" | "month" | "year";

export const BILLING_CYCLES: BillingCycle[] = ["day", "week", "month", "year"];

/** Average number of days in a cycle, used to normalise costs to a monthly figure. */
const CYCLE_DAYS: Record<BillingCycle, number> = {
  day: 1,
  week: 7,
  month: 30.4375, // 365.25 / 12
  year: 365.25,
};

const AVG_DAYS_PER_MONTH = CYCLE_DAYS.year / 12;

function addCycles(date: Date, cycle: BillingCycle, count: number): Date {
  switch (cycle) {
    case "day":
      return addDays(date, count);
    case "week":
      return addWeeks(date, count);
    case "month":
      return addMonths(date, count);
    case "year":
      return addYears(date, count);
  }
}

/** Parse an ISO "YYYY-MM-DD" (or full ISO) string into a local-midnight Date. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format a Date as "YYYY-MM-DD" in local time. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Compute the next renewal date on or after `from`, given an immutable start
 * date and a cycle/interval (e.g. every 3 months).
 *
 * If `startDate` is in the future, the start date itself is the next renewal.
 * We advance in whole periods (never mutating stored state) so the answer is
 * always derivable and drift-free.
 */
export function computeNextRenewal(
  startDate: string,
  cycle: BillingCycle,
  interval: number,
  from: Date = new Date(),
): Date {
  const step = Math.max(1, Math.floor(interval));
  const anchor = parseISODate(startDate);
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  if (anchor >= fromMidnight) return anchor;

  // Estimate how many periods have elapsed, then correct for month-length drift.
  const elapsedDays = differenceInCalendarDays(fromMidnight, anchor);
  const periodDays = CYCLE_DAYS[cycle] * step;
  let periods = Math.max(0, Math.floor(elapsedDays / periodDays));

  let next = addCycles(anchor, cycle, periods * step);
  // Walk forward until we're on/after `from` (handles month/leap-year edges).
  while (next < fromMidnight) {
    periods += 1;
    next = addCycles(anchor, cycle, periods * step);
  }
  return next;
}

/** Whole days from today until the next renewal (0 = due today). */
export function daysUntilRenewal(
  startDate: string,
  cycle: BillingCycle,
  interval: number,
  from: Date = new Date(),
): number {
  const next = computeNextRenewal(startDate, cycle, interval, from);
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return differenceInCalendarDays(next, fromMidnight);
}

/**
 * Whole days from today until an arbitrary ISO date (0 = today, negative = past).
 * Used for a cancelled subscription's "access ends" countdown.
 */
export function daysUntilDate(iso: string, from: Date = new Date()): number {
  const target = parseISODate(iso);
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return differenceInCalendarDays(target, fromMidnight);
}

/**
 * Normalise a price to its average monthly cost, so subscriptions on different
 * cycles can be summed and compared. E.g. £120/year -> £10/month.
 */
export function monthlyEquivalent(
  price: number,
  cycle: BillingCycle,
  interval: number,
): number {
  const step = Math.max(1, Math.floor(interval));
  const daysPerCharge = CYCLE_DAYS[cycle] * step;
  return (price / daysPerCharge) * AVG_DAYS_PER_MONTH;
}

/** Yearly equivalent cost, derived from the monthly equivalent. */
export function yearlyEquivalent(
  price: number,
  cycle: BillingCycle,
  interval: number,
): number {
  return monthlyEquivalent(price, cycle, interval) * 12;
}

/**
 * All renewal dates that fall within [rangeStart, rangeEnd] inclusive.
 * Used by the calendar to place markers. Guards against pathological input
 * (e.g. daily cycles over a huge range) with a hard cap.
 */
export function renewalsInRange(
  startDate: string,
  cycle: BillingCycle,
  interval: number,
  rangeStart: Date,
  rangeEnd: Date,
  cap = 400,
): Date[] {
  const step = Math.max(1, Math.floor(interval));
  const out: Date[] = [];
  let current = computeNextRenewal(startDate, cycle, step, rangeStart);
  let guard = 0;
  while (current <= rangeEnd && guard < cap) {
    out.push(current);
    current = addCycles(current, cycle, step);
    guard += 1;
  }
  return out;
}

/** Human label for a cycle/interval pair, e.g. (month, 1) -> "Monthly". */
export function describeCycle(cycle: BillingCycle, interval: number): string {
  const step = Math.max(1, Math.floor(interval));
  if (step === 1) {
    return { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" }[cycle];
  }
  const noun = { day: "days", week: "weeks", month: "months", year: "years" }[cycle];
  return `Every ${step} ${noun}`;
}
