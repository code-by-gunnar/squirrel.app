import { describe, it, expect } from "vitest";
import { convertToBase, rateForDate, ratesToMap } from "./currency";

describe("convertToBase", () => {
  const rates = new Map([
    ["USD", 0.79], // 1 USD = 0.79 GBP
    ["EUR", 0.85],
  ]);

  it("returns the amount unchanged when already in base", () => {
    expect(convertToBase(9, "GBP", "GBP", rates)).toBe(9);
  });

  it("multiplies by the code's rate to base", () => {
    expect(convertToBase(9, "USD", "GBP", rates)).toBeCloseTo(7.11, 5);
  });

  it("assumes identity for an unknown code", () => {
    expect(convertToBase(9, "JPY", "GBP", rates)).toBe(9);
  });
});

describe("ratesToMap", () => {
  it("keys rows by currency code", () => {
    const map = ratesToMap([
      { code: "USD", rateToBase: 0.79, fetchedAt: "" },
      { code: "EUR", rateToBase: 0.85, fetchedAt: "" },
    ]);
    expect(map.get("USD")).toBe(0.79);
    expect(map.get("EUR")).toBe(0.85);
  });
});

describe("rateForDate", () => {
  const byDate = new Map([
    ["2026-04-03", 0.79], // Fri
    ["2026-04-06", 0.78], // Mon
  ]);

  it("returns the exact rate when the date is present", () => {
    expect(rateForDate(byDate, "2026-04-06")).toBe(0.78);
  });

  it("falls back to the nearest earlier date (weekend/holiday)", () => {
    // Sat 2026-04-04 has no ECB fixing -> use Friday's rate.
    expect(rateForDate(byDate, "2026-04-04")).toBe(0.79);
  });

  it("returns null when no date on or before is available", () => {
    expect(rateForDate(byDate, "2026-04-01")).toBeNull();
  });
});
