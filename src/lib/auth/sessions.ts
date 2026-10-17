import { createHash, randomBytes } from "node:crypto";
import type { DB } from "../db";
import { nowIso } from "../db";
import { writeAudit } from "../audit";
import type { User } from "../types";
import {
  LOGIN_LOCKOUT_WINDOW_MS,
  LOGIN_MAX_FAILURES,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL_MS,
} from "./constants";
import { hashPassword, verifyPassword } from "./password";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();
const normalizeEmail = (email: string) => email.trim().toLowerCase();

// Verified against when the email is unknown, so both paths cost one scrypt and take the same time.
const DUMMY_CREDENTIAL = hashPassword(randomBytes(16).toString("hex"));

export function authenticate(db: DB, email: string, password: string): User | null {
  const row = db
    .prepare("SELECT id, email, name, role, password_salt, password_hash FROM users WHERE email = ?")
    .get(normalizeEmail(email)) as (User & { password_salt: string; password_hash: string }) | undefined;
  if (!row) {
    verifyPassword(password, DUMMY_CREDENTIAL.salt, DUMMY_CREDENTIAL.hash);
    return null;
  }
  if (!verifyPassword(password, row.password_salt, row.password_hash)) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryAfterMs: number };

// Failed attempts for this email inside the lockout window, since its last successful login.
function recentFailures(db: DB, email: string): string[] {
  const rows = db
    .prepare(
      `SELECT created_at FROM audit_log
       WHERE action = 'auth.login_failed' AND resource_type = 'login' AND resource_id = ? AND created_at > ?
         AND id > COALESCE((SELECT MAX(a.id) FROM audit_log a JOIN users u ON u.id = a.actor_id
                            WHERE a.action = 'session.create' AND u.email = ?), 0)
       ORDER BY id`,
    )
    .all(email, isoAgo(LOGIN_LOCKOUT_WINDOW_MS), email) as { created_at: string }[];
  return rows.map((r) => r.created_at);
}

// Checks the lockout, verifies credentials, and audits failed or blocked attempts.
// Lockout is keyed by the submitted email, so it reveals nothing about whether the account exists.
export function attemptLogin(db: DB, rawEmail: string, password: string, requestId: string): LoginResult {
  const email = normalizeEmail(rawEmail);
  return db
    .transaction((): LoginResult => {
      const failures = recentFailures(db, email);
      if (failures.length >= LOGIN_MAX_FAILURES) {
        const unlocksAt = Date.parse(failures[failures.length - LOGIN_MAX_FAILURES]) + LOGIN_LOCKOUT_WINDOW_MS;
        writeAudit(db, {
          actorId: null,
          action: "auth.login_blocked",
          resourceType: "login",
          resourceId: email,
          before: null,
          after: { recentFailures: failures.length, unlocksAt: new Date(unlocksAt).toISOString() },
          requestId,
        });
        return { ok: false, reason: "locked", retryAfterMs: Math.max(unlocksAt - Date.now(), 0) };
      }
      const user = authenticate(db, email, password);
      if (user) return { ok: true, user };
      writeAudit(db, {
        actorId: null,
        action: "auth.login_failed",
        resourceType: "login",
        resourceId: email,
        before: null,
        after: { recentFailures: failures.length + 1 },
        requestId,
      });
      return { ok: false, reason: "invalid" };
    })
    .immediate();
}

export function createSession(db: DB, userId: string, requestId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.transaction(() => {
    const now = nowIso();
    const stale = db
      .prepare(
        `SELECT id FROM sessions WHERE user_id = ?
           AND (revoked_at IS NOT NULL OR expires_at <= ? OR last_seen_at <= ?)`,
      )
      .all(userId, now, isoAgo(SESSION_IDLE_TIMEOUT_MS)) as { id: string }[];
    if (stale.length > 0) {
      const del = db.prepare("DELETE FROM sessions WHERE id = ?");
      for (const s of stale) del.run(s.id);
      writeAudit(db, {
        actorId: userId,
        action: "session.purge",
        resourceType: "user",
        resourceId: userId,
        before: { sessions: stale.map((s) => s.id.slice(0, 16)) },
        after: null,
        requestId,
      });
    }
    db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      userId,
      now,
      expiresAt.toISOString(),
      now,
    );
    writeAudit(db, {
      actorId: userId,
      action: "session.create",
      resourceType: "session",
      resourceId: id.slice(0, 16),
      before: null,
      after: { userId, expiresAt: expiresAt.toISOString() },
      requestId,
    });
  })();
  return { token, expiresAt };
}

type SessionRow = User & { session_id: string; last_seen_at: string };

function lookupSession(db: DB, token: string): SessionRow | undefined {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, s.id AS session_id, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen_at > ?`,
    )
    .get(hashToken(token), nowIso(), isoAgo(SESSION_IDLE_TIMEOUT_MS)) as SessionRow | undefined;
}

const toUser = (r: SessionRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role });

// Read-only lookup: valid only if not revoked, not past the absolute TTL, and not idle too long.
export function findUserBySessionToken(db: DB, token: string): User | null {
  const row = lookupSession(db, token);
  return row ? toUser(row) : null;
}

// Lookup for a live request: also records activity (at most every SESSION_TOUCH_INTERVAL_MS).
export function resolveSession(db: DB, token: string, requestId: string): User | null {
  const row = lookupSession(db, token);
  if (!row) return null;
  if (Date.now() - Date.parse(row.last_seen_at) >= SESSION_TOUCH_INTERVAL_MS) {
    db.transaction(() => {
      const lastSeenAt = nowIso();
      const res = db
        .prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at = ?")
        .run(lastSeenAt, row.session_id, row.last_seen_at);
      if (res.changes === 0) return;
      writeAudit(db, {
        actorId: row.id,
        action: "session.touch",
        resourceType: "session",
        resourceId: row.session_id.slice(0, 16),
        before: { lastSeenAt: row.last_seen_at },
        after: { lastSeenAt },
        requestId,
      });
    })();
  }
  return toUser(row);
}

export function revokeSession(db: DB, token: string, actorId: string, requestId: string): void {
  const id = hashToken(token);
  db.transaction(() => {
    const revokedAt = nowIso();
    const res = db
      .prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(revokedAt, id);
    if (res.changes === 0) return;
    writeAudit(db, {
      actorId,
      action: "session.revoke",
      resourceType: "session",
      resourceId: id.slice(0, 16),
      before: { revokedAt: null },
      after: { revokedAt },
      requestId,
    });
  })();
}

export function revokeAllSessions(db: DB, userId: string, actorId: string, requestId: string): number {
  return db.transaction(() => {
    const revokedAt = nowIso();
    const active = db
      .prepare("SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL")
      .all(userId) as { id: string }[];
    if (active.length === 0) return 0;
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(revokedAt, userId);
    writeAudit(db, {
      actorId,
      action: "session.revoke_all",
      resourceType: "user",
      resourceId: userId,
      before: { activeSessions: active.map((s) => s.id.slice(0, 16)) },
      after: { revokedAt },
      requestId,
    });
    return active.length;
  })();
}
