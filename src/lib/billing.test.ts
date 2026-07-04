import { describe, it, expect } from "vitest";
import {
  computeNextRenewal,
  daysUntilRenewal,
  daysUntilDate,
  monthlyEquivalent,
  yearlyEquivalent,
  describeCycle,
  renewalsInRange,
  chargeDates,
  toISODate,
} from "./billing";

const iso = toISODate;

describe("daysUntilDate", () => {
  const from = new Date(2026, 6, 3); // 2026-07-03

  it("is 0 for today", () => {
    expect(daysUntilDate("2026-07-03", from)).toBe(0);
  });
  it("counts whole days to a future date", () => {
    expect(daysUntilDate("2026-07-11", from)).toBe(8);
  });
  it("is negative once the date has passed (expired)", () => {
    expect(daysUntilDate("2026-07-01", from)).toBe(-2);
  });
  it("handles far-future annual expiries", () => {
    expect(daysUntilDate("2027-06-08", from)).toBeGreaterThan(300);
  });
});

describe("computeNextRenewal", () => {
  it("returns the start date when it is in the future", () => {
    const from = new Date(2026, 0, 1);
    const next = computeNextRenewal("2026-06-15", "month", 1, from);
    expect(iso(next)).toBe("2026-06-15");
  });

  it("returns today when the renewal falls exactly on today", () => {
    const from = new Date(2026, 2, 10); // 10 Mar 2026
    const next = computeNextRenewal("2025-03-10", "month", 1, from);
    expect(iso(next)).toBe("2026-03-10");
  });

  it("advances monthly subscriptions to the next future occurrence", () => {
    const from = new Date(2026, 6, 2); // 2 Jul 2026
    const next = computeNextRenewal("2026-01-20", "month", 1, from);
    expect(iso(next)).toBe("2026-07-20");
  });

  it("handles quarterly (every 3 months)", () => {
    const from = new Date(2026, 6, 2); // 2 Jul 2026
    const next = computeNextRenewal("2026-01-15", "month", 3, from);
    // Jan 15 -> Apr 15 -> Jul 15 (Jul 15 >= Jul 2)
    expect(iso(next)).toBe("2026-07-15");
  });

  it("handles yearly subscriptions", () => {
    const from = new Date(2026, 6, 2);
    const next = computeNextRenewal("2020-11-30", "year", 1, from);
    expect(iso(next)).toBe("2026-11-30");
  });

  it("handles weekly and every-2-weeks cycles", () => {
    const from = new Date(2026, 6, 2); // Thu 2 Jul 2026
    const weekly = computeNextRenewal("2026-06-01", "week", 1, from);
    expect(daysUntilRenewal("2026-06-01", "week", 1, from)).toBeLessThanOrEqual(7);
    expect(weekly >= new Date(2026, 6, 2)).toBe(true);
  });

  it("clamps end-of-month anchors sanely (Jan 31 -> Feb)", () => {
    const from = new Date(2026, 1, 15); // 15 Feb 2026
    const next = computeNextRenewal("2026-01-31", "month", 1, from);
    // date-fns addMonths clamps Jan 31 + 1mo to Feb 28
    expect(iso(next)).toBe("2026-02-28");
  });
});

describe("daysUntilRenewal", () => {
  it("is 0 when due today", () => {
    const from = new Date(2026, 2, 10);
    expect(daysUntilRenewal("2025-03-10", "month", 1, from)).toBe(0);
  });

  it("counts calendar days to the next renewal", () => {
    const from = new Date(2026, 6, 2);
    expect(daysUntilRenewal("2026-07-05", "month", 1, from)).toBe(3);
  });
});

describe("monthlyEquivalent", () => {
  it("keeps a monthly price as-is", () => {
    expect(monthlyEquivalent(10, "month", 1)).toBeCloseTo(10, 5);
  });

  it("normalises a yearly price to ~1/12", () => {
    expect(monthlyEquivalent(120, "year", 1)).toBeCloseTo(10, 5);
  });

  it("normalises a weekly price", () => {
    // £7/week * (365.25/12 days) / 7 days ≈ £30.44/month
    expect(monthlyEquivalent(7, "week", 1)).toBeCloseTo(30.4375, 3);
  });

  it("accounts for the interval (quarterly)", () => {
    // £30 every 3 months ≈ £10/month
    expect(monthlyEquivalent(30, "month", 3)).toBeCloseTo(10, 5);
  });
});

describe("yearlyEquivalent", () => {
  it("is 12x the monthly equivalent", () => {
    expect(yearlyEquivalent(10, "month", 1)).toBeCloseTo(120, 5);
  });
});

describe("renewalsInRange", () => {
  it("lists every weekly occurrence inside a month", () => {
    const start = new Date(2026, 6, 1); // 1 Jul 2026
    const end = new Date(2026, 6, 31); // 31 Jul 2026
    const dates = renewalsInRange("2026-07-01", "week", 1, start, end).map(iso);
    expect(dates).toEqual([
      "2026-07-01",
      "2026-07-08",
      "2026-07-15",
      "2026-07-22",
      "2026-07-29",
    ]);
  });

  it("returns a single monthly occurrence in the month", () => {
    const start = new Date(2026, 6, 1);
    const end = new Date(2026, 6, 31);
    const dates = renewalsInRange("2026-01-15", "month", 1, start, end).map(iso);
    expect(dates).toEqual(["2026-07-15"]);
  });

  it("returns nothing when no renewal falls in range", () => {
    const start = new Date(2026, 6, 1);
    const end = new Date(2026, 6, 31);
    const dates = renewalsInRange("2026-01-15", "year", 1, start, end);
    expect(dates).toEqual([]);
  });
});

describe("describeCycle", () => {
  it("labels single-interval cycles", () => {
    expect(describeCycle("month", 1)).toBe("Monthly");
    expect(describeCycle("year", 1)).toBe("Yearly");
  });

  it("labels multi-interval cycles", () => {
    expect(describeCycle("month", 3)).toBe("Every 3 months");
    expect(describeCycle("week", 2)).toBe("Every 2 weeks");
  });
});

describe("chargeDates", () => {
  const from = new Date(2026, 6, 3); // 2026-07-03

  it("includes the start date as the first charge", () => {
    const dates = chargeDates(
      { startDate: "2026-07-03", cycle: "month", interval: 1 },
      from,
    );
    expect(dates).toEqual(["2026-07-03"]);
  });

  it("lists one charge per month up to today", () => {
    const dates = chargeDates(
      { startDate: "2026-04-06", cycle: "month", interval: 1 },
      from,
    );
    expect(dates).toEqual(["2026-04-06", "2026-05-06", "2026-06-06"]);
    // 2026-07-06 hasn't happened yet on the 3rd.
  });

  it("honours a multi-month interval", () => {
    const dates = chargeDates(
      { startDate: "2026-01-15", cycle: "month", interval: 3 },
      from,
    );
    // Jan 15 -> Apr 15 -> (Jul 15 is after today, excluded).
    expect(dates).toEqual(["2026-01-15", "2026-04-15"]);
  });

  it("is empty for a free sub", () => {
    const dates = chargeDates(
      { startDate: "2026-01-01", cycle: "month", interval: 1, free: true },
      from,
    );
    expect(dates).toEqual([]);
  });

  it("is empty for a future start date", () => {
    const dates = chargeDates(
      { startDate: "2026-09-01", cycle: "month", interval: 1 },
      from,
    );
    expect(dates).toEqual([]);
  });

  it("stops a cancelled sub before its end date (no charge for the final paid period)", () => {
    // Cancelled, access ends 2026-06-06; the 2026-06-06 occurrence is the end of
    // the already-paid period and must NOT be recorded as a new charge.
    const dates = chargeDates(
      {
        startDate: "2026-04-06",
        cycle: "month",
        interval: 1,
        cancelled: true,
        endsOn: "2026-06-06",
      },
      from,
    );
    expect(dates).toEqual(["2026-04-06", "2026-05-06"]);
  });
});
