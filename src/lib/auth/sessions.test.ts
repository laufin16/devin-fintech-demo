import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type DB } from "../db";
import { DEMO_PASSWORD } from "../db/seed";
import { authenticate, createSession, findUserBySessionToken, revokeSession } from "./sessions";

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("sessions", () => {
  it("authenticates valid credentials only", () => {
    expect(authenticate(db, "ava@acme.dev", DEMO_PASSWORD)?.role).toBe("approver");
    expect(authenticate(db, "ava@acme.dev", "wrong")).toBeNull();
    expect(authenticate(db, "nobody@acme.dev", DEMO_PASSWORD)).toBeNull();
  });

  it("creates, resolves and revokes sessions with audit rows", () => {
    const { token } = createSession(db, "u_sam", "req-login");
    expect(findUserBySessionToken(db, token)?.id).toBe("u_sam");
    revokeSession(db, token, "u_sam", "req-logout");
    expect(findUserBySessionToken(db, token)).toBeNull();
    const actions = (db.prepare("SELECT action FROM audit_log WHERE resource_type = 'session'").all() as { action: string }[]).map(
      (r) => r.action,
    );
    expect(actions).toEqual(["session.create", "session.revoke"]);
  });
});
