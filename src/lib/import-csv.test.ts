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

  it("rejects calendar-invalid dates (Feb 30) rather than rolling them over", () => {
    const r = parseSubscriptionsCsv(csv("Name,Start date", "A,2025-02-30"), opts);
    expect(r.ready).toEqual([]);
    expect(r.skipped).toEqual([
      { line: 2, name: "A", reason: 'Invalid start date "2025-02-30".' },
    ]);
  });

  it('parses "Annually" prose to year/1', () => {
    const r = parseSubscriptionsCsv(csv("Name,Billing", "A,Annually"), opts);
    expect(r.ready[0]).toMatchObject({ billingCycle: "year", billingInterval: 1 });
  });

  it("rejects a non-integer billing interval", () => {
    const r = parseSubscriptionsCsv(
      csv("Name,Billing cycle,Billing interval", "A,month,3x"),
      opts,
    );
    expect(r.skipped).toEqual([
      { line: 2, name: "A", reason: 'Invalid billing interval "3x".' },
    ]);
  });
});

describe("buildImportTemplate", () => {
  it("has the documented headers and one example row", () => {
    const lines = buildImportTemplate().split("\r\n");
    expect(lines[0]).toBe(SUBSCRIPTION_IMPORT_HEADERS.join(","));
    expect(lines[1]).toContain("Netflix");
  });
});
