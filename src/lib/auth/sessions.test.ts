import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type DB } from "../db";
import { DEMO_PASSWORD } from "../db/seed";
import {
  LOGIN_LOCKOUT_WINDOW_MS,
  LOGIN_MAX_FAILURES,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from "./constants";
import {
  attemptLogin,
  authenticate,
  createSession,
  findUserBySessionToken,
  resolveSession,
  revokeAllSessions,
  revokeSession,
} from "./sessions";

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

describe("login lockout", () => {
  const attempt = (email: string, password: string) => attemptLogin(db, email, password, "req");
  const auditCount = (action: string) =>
    (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;

  afterEach(() => vi.useRealTimers());

  it("audits failures and locks the email after too many", () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect(attempt("ava@acme.dev", "wrong")).toEqual({ ok: false, reason: "invalid" });
    const locked = attempt("ava@acme.dev", DEMO_PASSWORD);
    expect(locked).toMatchObject({ ok: false, reason: "locked" });
    expect(auditCount("auth.login_failed")).toBe(LOGIN_MAX_FAILURES);
    expect(auditCount("auth.login_blocked")).toBe(1);
    expect(attempt("ben@acme.dev", DEMO_PASSWORD).ok).toBe(true);
  });

  it("locks unknown emails the same way", () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) attempt("ghost@acme.dev", "x");
    expect(attempt("ghost@acme.dev", "x")).toMatchObject({ reason: "locked" });
  });

  it("unlocks after the window passes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) attempt("ava@acme.dev", "wrong");
    vi.setSystemTime(Date.now() + LOGIN_LOCKOUT_WINDOW_MS + 1000);
    expect(attempt("ava@acme.dev", DEMO_PASSWORD).ok).toBe(true);
  });

  it("resets the failure count after a successful login", () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) attempt("ava@acme.dev", "wrong");
    const ok = attempt("ava@acme.dev", DEMO_PASSWORD);
    if (!ok.ok) throw new Error("expected success");
    createSession(db, ok.user.id, "req");
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) attempt("ava@acme.dev", "wrong");
    expect(attempt("ava@acme.dev", DEMO_PASSWORD).ok).toBe(true);
  });
});

describe("session lifecycle", () => {
  afterEach(() => vi.useRealTimers());
  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

  it("expires idle sessions and refreshes activity with an audit row", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { token } = createSession(db, "u_ava", "req");
    advance(SESSION_TOUCH_INTERVAL_MS + 1000);
    expect(resolveSession(db, token, "req")?.id).toBe("u_ava");
    const touches = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'session.touch'").get() as { n: number };
    expect(touches.n).toBe(1);
    advance(SESSION_IDLE_TIMEOUT_MS + SESSION_TOUCH_INTERVAL_MS - 60_000);
    expect(findUserBySessionToken(db, token)?.id).toBe("u_ava");
    advance(120_000);
    expect(findUserBySessionToken(db, token)).toBeNull();
  });

  it("never expires before the full idle timeout of real inactivity", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { token } = createSession(db, "u_ava", "req");
    advance(SESSION_TOUCH_INTERVAL_MS - 1000);
    expect(resolveSession(db, token, "req")?.id).toBe("u_ava"); // not recorded: inside the touch interval
    advance(SESSION_IDLE_TIMEOUT_MS - 1000);
    expect(resolveSession(db, token, "req")?.id).toBe("u_ava");
  });

  it("does not revive a session revoked between lookup and touch", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { token } = createSession(db, "u_ava", "req");
    advance(SESSION_TOUCH_INTERVAL_MS + 1000);
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("SET last_seen_at")) revokeSession(db, token, "u_ava", "req-logout");
      return prepare(sql);
    });
    expect(resolveSession(db, token, "req")).toBeNull();
    vi.restoreAllMocks();
    const touches = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'session.touch'").get() as { n: number };
    expect(touches.n).toBe(0);
  });

  it("does not write on every request", () => {
    const { token } = createSession(db, "u_ava", "req");
    resolveSession(db, token, "req");
    resolveSession(db, token, "req");
    const touches = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'session.touch'").get() as { n: number };
    expect(touches.n).toBe(0);
  });

  it("revokes every session for a user", () => {
    const a = createSession(db, "u_ava", "req").token;
    const b = createSession(db, "u_ava", "req").token;
    const other = createSession(db, "u_ben", "req").token;
    expect(revokeAllSessions(db, "u_ava", "u_ava", "req")).toBe(2);
    expect(findUserBySessionToken(db, a)).toBeNull();
    expect(findUserBySessionToken(db, b)).toBeNull();
    expect(findUserBySessionToken(db, other)?.id).toBe("u_ben");
  });

  it("purges stale sessions on the next login, with an audit row", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    createSession(db, "u_ava", "req");
    advance(SESSION_IDLE_TIMEOUT_MS + SESSION_TOUCH_INTERVAL_MS + 1000);
    createSession(db, "u_ava", "req");
    const rows = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'u_ava'").get() as { n: number };
    expect(rows.n).toBe(1);
    const purge = db.prepare("SELECT before_json FROM audit_log WHERE action = 'session.purge'").get() as { before_json: string };
    expect(JSON.parse(purge.before_json).sessions).toHaveLength(1);
  });
});
