import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";
import { seed } from "./seed";

export type DB = Database.Database;

export function createDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  db.exec(SCHEMA_SQL);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (n === 0) seed(db);
  return db;
}

// Upgrades databases created before a column existed. CREATE TABLE IF NOT EXISTS won't add columns.
function migrate(db: DB) {
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === "last_seen_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE sessions SET last_seen_at = created_at");
  }
}

const globalForDb = globalThis as unknown as { __db?: DB };

export function getDb(): DB {
  globalForDb.__db ??= createDb(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db"));
  return globalForDb.__db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
