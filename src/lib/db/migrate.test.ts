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

it("adds sessions.last_seen_at to old databases without signing out live sessions, with audit rows", () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
  const file = path.join(dir, "old.db");
  const old = new Database(file);
  old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL, revoked_at TEXT)`);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const inHours = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
  const insert = old.prepare("INSERT INTO sessions VALUES (?, 'u_ava', ?, ?, ?)");
  insert.run("live", hourAgo, inHours, null);
  insert.run("revoked", hourAgo, inHours, hourAgo);
  insert.run("expired", "2026-01-01T00:00:00.000Z", "2026-01-01T08:00:00.000Z", null);
  old.close();

  const before = new Date().toISOString();
  const db = createDb(file);
  const seen = Object.fromEntries(
    (db.prepare("SELECT id, last_seen_at FROM sessions").all() as { id: string; last_seen_at: string }[]).map((r) => [
      r.id,
      r.last_seen_at,
    ]),
  );
  expect(seen.live >= before).toBe(true);
  expect(seen.revoked).toBe(hourAgo);
  expect(seen.expired).toBe("2026-01-01T00:00:00.000Z");

  const audits = db
    .prepare("SELECT resource_id, actor_id, request_id, after_json FROM audit_log WHERE action = 'session.migrate' ORDER BY resource_id")
    .all() as { resource_id: string; actor_id: string | null; request_id: string; after_json: string }[];
  expect(audits.map((a) => a.resource_id)).toEqual(["expired", "live", "revoked"]);
  expect(new Set(audits.map((a) => a.request_id)).size).toBe(1);
  expect(audits[0].request_id).toMatch(/^migration-/);
  expect(audits.every((a) => a.actor_id === null)).toBe(true);
  expect(JSON.parse(audits[1].after_json).lastSeenAt).toBe(seen.live);
  db.close();

  // Idempotent: reopening doesn't migrate again.
  const reopened = createDb(file);
  const n = reopened.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'session.migrate'").get() as { n: number };
  expect(n.n).toBe(3);
  reopened.close();
});

it("backfills KYC data into databases created before the KYC queue, with an audit row", () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
  const file = path.join(dir, "pre-kyc.db");
  createDb(file).close();
  const old = new Database(file);
  old.exec("DROP TABLE kyc_notes; DROP TABLE kyc_checks; DROP TABLE kyc_documents; DROP TABLE kyc_cases;");
  old.close();

  const db = createDb(file);
  expect(db.prepare("SELECT COUNT(*) AS n FROM kyc_cases").get()).toEqual({ n: 8 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'system.seed_kyc'").get()).toEqual({ n: 2 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM refunds").get()).toEqual({ n: 8 });
  db.close();
});
