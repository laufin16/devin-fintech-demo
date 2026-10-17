import { createHash, randomBytes } from "node:crypto";
import type { DB } from "../db";
import { nowIso } from "../db";
import { writeAudit } from "../audit";
import type { User } from "../types";
import { SESSION_TTL_MS } from "./constants";
import { verifyPassword } from "./password";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function authenticate(db: DB, email: string, password: string): User | null {
  const row = db
    .prepare("SELECT id, email, name, role, password_salt, password_hash FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as (User & { password_salt: string; password_hash: string }) | undefined;
  if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function createSession(db: DB, userId: string, requestId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.transaction(() => {
    db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
      id,
      userId,
      nowIso(),
      expiresAt.toISOString(),
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

export function findUserBySessionToken(db: DB, token: string): User | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .get(hashToken(token), nowIso()) as User | undefined;
  return row ?? null;
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
