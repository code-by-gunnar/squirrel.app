import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

/**
 * `deleteContextAndUnassign` is the only place that deletes a `contexts` row.
 * It has to null out every referencing subscription's `contextId` first,
 * because `context_id`'s FK was added via `ALTER TABLE ... REFERENCES`
 * (migration 0004) and SQLite does not enforce `ON DELETE SET NULL` for FKs
 * added that way — a bare `DELETE FROM contexts` throws "FOREIGN KEY
 * constraint failed" for any context still assigned to a subscription.
 *
 * This exercises the real db layer (better-sqlite3 + drizzle + the app's own
 * migrations) against a throwaway temp file, since the existing test suite is
 * otherwise pure. `DATABASE_PATH` must be set before `@/db` is first imported
 * (it's read at module load time), so the imports are dynamic and deferred to
 * `beforeAll`.
 */
describe("deleteContextAndUnassign", () => {
  let dbPath: string;
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db/schema");
  let deleteContextAndUnassign: typeof import("./subscriptions").deleteContextAndUnassign;

  beforeAll(async () => {
    dbPath = path.join(
      os.tmpdir(),
      `squirrel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    process.env.DATABASE_PATH = dbPath;

    ({ db } = await import("@/db"));
    schema = await import("@/db/schema");
    ({ deleteContextAndUnassign } = await import("./subscriptions"));
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

  it("deletes the context and nulls the subscription's contextId, without throwing", () => {
    const { contexts, subscriptions } = schema;

    const ctxId = Number(
      db
        .insert(contexts)
        .values({ name: "Freelance", color: "#111111" })
        .run().lastInsertRowid,
    );
    const subId = Number(
      db
        .insert(subscriptions)
        .values({
          name: "Test Sub",
          price: 9.99,
          currencyCode: "GBP",
          billingCycle: "month",
          billingInterval: 1,
          startDate: "2026-01-01",
          contextId: ctxId,
        })
        .run().lastInsertRowid,
    );

    // Sanity check: assignment landed before we delete.
    expect(
      db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get()
        ?.contextId,
    ).toBe(ctxId);

    expect(() => deleteContextAndUnassign(ctxId)).not.toThrow();

    const ctxRow = db.select().from(contexts).where(eq(contexts.id, ctxId)).get();
    expect(ctxRow).toBeUndefined();

    const subRow = db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subId))
      .get();
    expect(subRow?.contextId).toBeNull();
  });
});

describe("listSubscriptions prepaid enrichment", () => {
  let dbPath: string;
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db/schema");
  let listSubscriptions: typeof import("./subscriptions").listSubscriptions;

  beforeAll(async () => {
    dbPath = path.join(
      os.tmpdir(),
      `squirrel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    process.env.DATABASE_PATH = dbPath;

    // The previous describe block already created and closed a `@/db`
    // connection cached on `globalThis` (Next.js hot-reload caching), and its
    // module graph is still in the import cache with the OLD `DATABASE_PATH`
    // baked into its top-level `DB_PATH` constant. Clear both so this block
    // gets its own fresh connection at the new temp path instead of reusing
    // (and finding closed) the prior one.
    delete (globalThis as unknown as { __squirrelDb?: unknown }).__squirrelDb;
    vi.resetModules();

    ({ db } = await import("@/db"));
    schema = await import("@/db/schema");
    ({ listSubscriptions } = await import("./subscriptions"));
  });

  afterAll(() => {
    delete process.env.DATABASE_PATH;
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

  it("zeroes recurring cost and derives depletion for a prepaid sub", () => {
    const { subscriptions } = schema;
    db.insert(subscriptions).values({
      name: "OpenAI credits", price: 50, currencyCode: "GBP",
      startDate: "2026-01-01", prepaid: true, depletesOn: "2026-07-16", // 10 days out from a fixed 'today'
    }).run();

    const [s] = listSubscriptions().filter((x) => x.name === "OpenAI credits");
    expect(s.prepaid).toBe(true);
    expect(s.monthlyBase).toBe(0);
    expect(s.yearlyBase).toBe(0);
    expect(typeof s.daysUntilDepletion).toBe("number");
    expect(s.depleted).toBe(false); // depletesOn is in the future
  });

  it("marks a prepaid sub depleted once depletesOn has passed", () => {
    const { subscriptions } = schema;
    db.insert(subscriptions).values({
      name: "Old credits", price: 10, currencyCode: "GBP",
      startDate: "2020-01-01", prepaid: true, depletesOn: "2020-02-01",
    }).run();
    const [s] = listSubscriptions().filter((x) => x.name === "Old credits");
    expect(s.depleted).toBe(true);
    expect(s.daysUntilDepletion).toBeLessThan(0);
  });

  it("leaves daysUntilDepletion null when no depletesOn", () => {
    const { subscriptions } = schema;
    db.insert(subscriptions).values({
      name: "No estimate", price: 10, currencyCode: "GBP",
      startDate: "2026-01-01", prepaid: true,
    }).run();
    const [s] = listSubscriptions().filter((x) => x.name === "No estimate");
    expect(s.daysUntilDepletion).toBeNull();
    expect(s.depleted).toBe(false);
  });
});
