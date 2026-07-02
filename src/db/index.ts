import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { seedDefaults } from "./seed";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/squirrel.db";

/**
 * Cache the connection on `globalThis` so Next.js hot reloads (and repeated
 * imports) reuse a single SQLite handle.
 */
const globalForDb = globalThis as unknown as {
  __squirrelDb?: ReturnType<typeof createDb>;
};

function createDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  // Apply any pending migrations on first connection.
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (fs.existsSync(migrationsFolder)) {
    migrate(db, { migrationsFolder });
  }

  seedDefaults(db);

  return db;
}

function getDb() {
  if (!globalForDb.__squirrelDb) globalForDb.__squirrelDb = createDb();
  return globalForDb.__squirrelDb;
}

/**
 * Lazy proxy: the SQLite connection + migrations are deferred until the first
 * actual query at runtime. This is important because `next build` imports every
 * route module across many worker processes; connecting eagerly at import time
 * made those workers race to run migrations against one fresh DB file.
 */
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export { schema };
