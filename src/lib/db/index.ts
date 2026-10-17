import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { writeAudit } from "../audit";
import { SCHEMA_SQL } from "./schema";
import { seed } from "./seed";

export type DB = Database.Database;

export function createDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  // Schema first so audit_log exists for migrations; CREATE TABLE IF NOT EXISTS leaves old tables as-is.
  db.exec(SCHEMA_SQL);
  migrate(db);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (n === 0) seed(db);
  return db;
}

// Upgrades databases created before sessions.last_seen_at existed. Live sessions start their idle clock
// at migration time (their real last activity is unknown), so the upgrade doesn't sign anyone out.
function migrate(db: DB) {
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (cols.some((c) => c.name === "last_seen_at")) return;
  const requestId = `migration-${randomUUID()}`;
  db.transaction(() => {
    db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''");
    const now = nowIso();
    const sessions = db
      .prepare("SELECT id, created_at, expires_at, revoked_at FROM sessions")
      .all() as { id: string; created_at: string; expires_at: string; revoked_at: string | null }[];
    const update = db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?");
    for (const s of sessions) {
      const lastSeenAt = s.revoked_at === null && s.expires_at > now ? now : s.created_at;
      update.run(lastSeenAt, s.id);
      writeAudit(db, {
        actorId: null,
        action: "session.migrate",
        resourceType: "session",
        resourceId: s.id.slice(0, 16),
        before: { lastSeenAt: null },
        after: { lastSeenAt },
        requestId,
      });
    }
  })();
}

const globalForDb = globalThis as unknown as { __db?: DB };

export function getDb(): DB {
  globalForDb.__db ??= createDb(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db"));
  return globalForDb.__db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
