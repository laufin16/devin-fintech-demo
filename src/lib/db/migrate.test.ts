import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { createDb } from ".";

let dir: string | undefined;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

it("adds sessions.last_seen_at to databases created before it existed", () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
  const file = path.join(dir, "old.db");
  const old = new Database(file);
  old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL, revoked_at TEXT)`);
  old.prepare("INSERT INTO sessions VALUES ('s1', 'u_ava', '2026-01-01T00:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)").run();
  old.close();

  const db = createDb(file);
  const row = db.prepare("SELECT created_at, last_seen_at FROM sessions WHERE id = 's1'").get() as Record<string, string>;
  expect(row.last_seen_at).toBe(row.created_at);
  db.close();
});
