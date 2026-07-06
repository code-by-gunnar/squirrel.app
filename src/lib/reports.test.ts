import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * `getMonthlySpend` reads through the real db layer (better-sqlite3 + drizzle
 * + the app's own migrations), so this exercises it against a throwaway temp
 * file rather than mocking the query builder — same rationale as
 * `subscriptions.test.ts`. `DATABASE_PATH` must be set before `@/db` is first
 * imported (it's read at module load time), so the imports are dynamic and
 * deferred to `beforeAll`.
 */
describe("getMonthlySpend", () => {
  let dbPath: string;
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db/schema");
  let getMonthlySpend: typeof import("./reports").getMonthlySpend;
  type MonthlySpend = import("./reports").MonthlySpend;

  beforeAll(async () => {
    dbPath = path.join(
      os.tmpdir(),
      `squirrel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    process.env.DATABASE_PATH = dbPath;

    delete (globalThis as unknown as { __squirrelDb?: unknown }).__squirrelDb;
    vi.resetModules();

    ({ db } = await import("@/db"));
    schema = await import("@/db/schema");
    ({ getMonthlySpend } = await import("./reports"));
  });

  afterAll(() => {
    delete process.env.DATABASE_PATH;
    // Release the file lock (better-sqlite3 keeps it open) so the temp file
    // can actually be removed on Windows — reach through drizzle's session
    // to the raw client, since `db/index.ts` doesn't expose a close() itself.
    try {
      (db as unknown as { session: { client: { close(): void } } }).session.client.close();
    } catch {
      // best-effort
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        // best-effort cleanup
      }
    }
  });

  const NOW = new Date(2026, 6, 6); // 2026-07-06 (month index 6 = July), local time

  function addSub(over: Record<string, unknown>): number {
    const { subscriptions } = schema;
    return Number(
      db.insert(subscriptions).values({
        name: "X", price: 10, currencyCode: "GBP",
        billingCycle: "month", billingInterval: 1, startDate: "2020-01-01",
        ...over,
      }).run().lastInsertRowid,
    );
  }
  function addPayment(subId: number, paidOn: string, amountBase: number) {
    const { payments } = schema;
    db.insert(payments).values({
      subscriptionId: subId, paidOn, amount: amountBase, currencyCode: "GBP",
      amountBase, baseCurrency: "GBP", fxRate: 1,
    }).run();
  }
  function month(series: MonthlySpend[], key: string) {
    return series.find((m) => m.month === key)!;
  }

  it("puts a past ledger charge in its month as a billed item", () => {
    const id = addSub({ name: "Netflix" });
    addPayment(id, "2026-05-15", 9.99);
    const may = month(getMonthlySpend("all", 12, 3, NOW), "2026-05");
    expect(may.recorded).toBe(9.99);
    expect(may.forecast).toBe(0);
    expect(may.total).toBe(9.99);
    expect(may.items).toHaveLength(1);
    expect(may.items[0]).toMatchObject({ name: "Netflix", kind: "billed", amount: 9.99, date: "2026-05-15" });
  });

  it("forecasts an annual sub due later THIS month (the dead-zone bug)", () => {
    // yearly sub whose next renewal on/after 2026-07-06 is 2026-07-20
    addSub({ name: "Annual", price: 120, billingCycle: "year", startDate: "2020-07-20" });
    const series = getMonthlySpend("all", 12, 3, NOW);
    const jul = month(series, "2026-07");
    const forecastItem = jul.items.find((i) => i.name === "Annual");
    expect(forecastItem).toMatchObject({ kind: "forecast", date: "2026-07-20" });
    expect(jul.forecast).toBeCloseTo(120, 2);
    // and it appears in no other month within the window
    const others = series.filter((m) => m.month !== "2026-07");
    expect(others.some((m) => m.items.some((i) => i.name === "Annual"))).toBe(false);
  });

  it("does not double-count a charge due today that is already recorded", () => {
    // monthly sub renewing on the 6th; today is the 6th; the July-6 charge is recorded
    const id = addSub({ name: "Spotify", billingCycle: "month", startDate: "2026-06-06" });
    addPayment(id, "2026-07-06", 10);
    const jul = month(getMonthlySpend("all", 12, 3, NOW), "2026-07");
    const spotifyRows = jul.items.filter((i) => i.name === "Spotify");
    expect(spotifyRows).toHaveLength(1);          // billed only, no forecast dupe
    expect(spotifyRows[0].kind).toBe("billed");
    expect(jul.recorded + jul.forecast).toBeCloseTo(jul.total, 2);
  });

  it("makes a future month all forecast", () => {
    addSub({ name: "Monthly", billingCycle: "month", startDate: "2026-01-10" });
    const aug = month(getMonthlySpend("all", 12, 3, NOW), "2026-08");
    expect(aug.recorded).toBe(0);
    expect(aug.items.every((i) => i.kind === "forecast")).toBe(true);
    expect(aug.items.some((i) => i.name === "Monthly" && i.date === "2026-08-10")).toBe(true);
  });

  it("excludes free/prepaid/cancelled from the forecast", () => {
    addSub({ name: "Free", free: true, billingCycle: "month", startDate: "2026-01-15" });
    addSub({ name: "Prepaid", prepaid: true, billingCycle: "month", startDate: "2026-01-15" });
    addSub({ name: "Cancelled", cancelled: true, endsOn: "2026-06-01", billingCycle: "month", startDate: "2026-01-15" });
    const aug = month(getMonthlySpend("all", 12, 3, NOW), "2026-08");
    expect(aug.items.some((i) => ["Free", "Prepaid", "Cancelled"].includes(i.name))).toBe(false);
  });
});
