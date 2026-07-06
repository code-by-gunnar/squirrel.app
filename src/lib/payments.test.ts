import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

/**
 * Exercises `recordTopUp` and the prepaid guard in `backfillPayments` against a
 * real temp SQLite DB (better-sqlite3 + drizzle + the app's own migrations),
 * mirroring the harness in `src/lib/subscriptions.test.ts`. `DATABASE_PATH` must
 * be set before `@/db` is first imported (it's read at module load time), so the
 * imports are dynamic and deferred to `beforeAll`.
 */
describe("payments ledger (prepaid)", () => {
  let dbPath: string;
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db/schema");
  let recordTopUp: typeof import("./payments").recordTopUp;
  let backfillPayments: typeof import("./payments").backfillPayments;

  beforeAll(async () => {
    dbPath = path.join(
      os.tmpdir(),
      `squirrel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    process.env.DATABASE_PATH = dbPath;

    ({ db } = await import("@/db"));
    schema = await import("@/db/schema");
    ({ recordTopUp, backfillPayments } = await import("./payments"));
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

  describe("recordTopUp", () => {
    it("records a charge for the given date and amount (same currency => rate 1)", async () => {
      const { subscriptions, payments } = schema;
      const id = Number(
        db
          .insert(subscriptions)
          .values({
            name: "OpenAI credits",
            price: 50,
            currencyCode: "GBP",
            startDate: "2026-01-01",
            prepaid: true,
          })
          .run().lastInsertRowid,
      );

      await recordTopUp(id, "2026-01-01", 50, "GBP");

      const rows = db.select().from(payments).where(eq(payments.subscriptionId, id)).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(50);
      expect(rows[0].amountBase).toBe(50);
      expect(rows[0].fxRate).toBe(1);
      expect(rows[0].paidOn).toBe("2026-01-01");
    });

    it("sums a same-day top-up into the existing charge", async () => {
      const { subscriptions, payments } = schema;
      const id = Number(
        db
          .insert(subscriptions)
          .values({
            name: "Credits",
            price: 20,
            currencyCode: "GBP",
            startDate: "2026-01-01",
            prepaid: true,
          })
          .run().lastInsertRowid,
      );

      await recordTopUp(id, "2026-02-10", 20, "GBP");
      await recordTopUp(id, "2026-02-10", 30, "GBP");

      const rows = db
        .select()
        .from(payments)
        .where(eq(payments.subscriptionId, id))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(50);
      expect(rows[0].amountBase).toBe(50);
    });
  });

  describe("backfillPayments skips prepaid", () => {
    it("records no computed charges for a prepaid sub", async () => {
      const { subscriptions, payments } = schema;
      const id = Number(
        db
          .insert(subscriptions)
          .values({
            name: "Credits",
            price: 50,
            currencyCode: "GBP",
            startDate: "2020-01-01",
            billingCycle: "month",
            billingInterval: 1,
            prepaid: true,
          })
          .run().lastInsertRowid,
      );

      await backfillPayments(id);

      const rows = db.select().from(payments).where(eq(payments.subscriptionId, id)).all();
      expect(rows).toHaveLength(0);
    });
  });
});
