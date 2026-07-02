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
 * Next.js re-evaluates modules on hot reload, so we cache the connection on
 * `globalThis` to avoid opening multiple SQLite handles in development.
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

export const db = globalForDb.__squirrelDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__squirrelDb = db;

export { schema };
