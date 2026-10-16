import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type DB } from "./db";
import { REFUND_RESERVE_ACCOUNT, customerAccountId } from "./db/seed";
import { writeAudit } from "./audit";
import { ConflictError, ForbiddenError, InsufficientFundsError } from "./errors";
import { accountBalance } from "./ledger";
import { actionItemFor, decideRefund, getRefund, processRefund } from "./refunds";
import type { User } from "./types";

const ava: User = { id: "u_ava", email: "ava@acme.dev", name: "Ava Approver", role: "approver" };
const sam: User = { id: "u_sam", email: "sam@acme.dev", name: "Sam Admin", role: "admin" };

let db: DB;
const auditCount = () => (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
const ledgerTxnCount = () => (db.prepare("SELECT COUNT(*) AS n FROM ledger_transactions").get() as { n: number }).n;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("audit log", () => {
  it("is append-only", () => {
    expect(() => db.prepare("UPDATE audit_log SET action = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
  });

  it("refuses writes outside a transaction", () => {
    expect(() =>
      writeAudit(db, { actorId: null, action: "x", resourceType: "x", resourceId: "x", before: null, after: null, requestId: "r" }),
    ).toThrow(/inside the transaction/);
  });
});

describe("decideRefund", () => {
  it("approves a pending refund, bumps the version and writes an audit row", () => {
    const before = auditCount();
    const after = decideRefund(db, ava, { refundId: "rf_1001", decision: "approve", expectedVersion: 1, requestId: "req-1" });
    expect(after.status).toBe("approved");
    expect(after.version).toBe(2);
    expect(auditCount()).toBe(before + 1);
    const row = db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1").get() as Record<string, string>;
    expect(row.action).toBe("refund.approve");
    expect(JSON.parse(row.before_json).status).toBe("pending");
    expect(JSON.parse(row.after_json).status).toBe("approved");
    expect(row.request_id).toBe("req-1");
  });

  it("rejects stale versions without writing anything", () => {
    const before = auditCount();
    expect(() =>
      decideRefund(db, ava, { refundId: "rf_1001", decision: "approve", expectedVersion: 99, requestId: "r" }),
    ).toThrow(ConflictError);
    expect(getRefund(db, ava, "rf_1001").status).toBe("pending");
    expect(auditCount()).toBe(before);
  });

  it("rolls back the change if the audit write fails", () => {
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END;");
    expect(() =>
      decideRefund(db, ava, { refundId: "rf_1001", decision: "reject", expectedVersion: 1, requestId: "r" }),
    ).toThrow(/audit down/);
    expect(getRefund(db, ava, "rf_1001").status).toBe("pending");
  });
});

describe("processRefund", () => {
  const input = { refundId: "rf_1003", expectedVersion: 2, idempotencyKey: "key-1", requestId: "req-p" };

  it("is forbidden for approvers", () => {
    expect(() => processRefund(db, ava, input)).toThrow(ForbiddenError);
  });

  it("moves money through a balanced double-entry transaction", () => {
    const reserve = accountBalance(db, REFUND_RESERVE_ACCOUNT);
    const customer = accountBalance(db, customerAccountId("c_3"));
    const result = processRefund(db, sam, input);
    expect(result.replayed).toBe(false);

    const entries = db.prepare("SELECT amount_cents FROM ledger_entries WHERE txn_id = ?").all(result.ledgerTxnId) as {
      amount_cents: number;
    }[];
    expect(entries.reduce((s, e) => s + e.amount_cents, 0)).toBe(0);
    expect(accountBalance(db, REFUND_RESERVE_ACCOUNT)).toBe(reserve - 2500);
    expect(accountBalance(db, customerAccountId("c_3"))).toBe(customer + 2500);

    const refund = getRefund(db, sam, "rf_1003");
    expect(refund.status).toBe("processed");
    expect(refund.ledger_txn_id).toBe(result.ledgerTxnId);
  });

  it("is idempotent: replaying the same key does not move money twice", () => {
    const first = processRefund(db, sam, input);
    const txns = ledgerTxnCount();
    const audits = auditCount();
    const second = processRefund(db, sam, input);
    expect(second).toEqual({ ...first, replayed: true });
    expect(ledgerTxnCount()).toBe(txns);
    expect(auditCount()).toBe(audits);
  });

  it("rejects reuse of an idempotency key for a different refund", () => {
    processRefund(db, sam, input);
    expect(() => processRefund(db, sam, { ...input, refundId: "rf_1007" })).toThrow(ConflictError);
  });

  it("rejects a second payout with a new key (version check)", () => {
    processRefund(db, sam, input);
    expect(() => processRefund(db, sam, { ...input, idempotencyKey: "key-2" })).toThrow(ConflictError);
  });

  it("does not process refunds that are not approved", () => {
    expect(() => processRefund(db, sam, { ...input, refundId: "rf_1001", expectedVersion: 1 })).toThrow(ConflictError);
  });

  it("refuses to overdraw the reserve and leaves no partial writes", () => {
    db.prepare(
      `INSERT INTO refunds (id, customer_id, order_ref, amount_cents, reason, status, version, created_at, updated_at)
       VALUES ('rf_big', 'c_1', 'ORD-X', 999999999, 'test', 'approved', 1, '2026-01-01', '2026-01-01')`,
    ).run();
    const txns = ledgerTxnCount();
    const audits = auditCount();
    expect(() =>
      processRefund(db, sam, { refundId: "rf_big", expectedVersion: 1, idempotencyKey: "k-big", requestId: "r" }),
    ).toThrow(InsufficientFundsError);
    expect(getRefund(db, sam, "rf_big").status).toBe("approved");
    expect(ledgerTxnCount()).toBe(txns);
    expect(auditCount()).toBe(audits);
  });

  it("stores amounts only as integers", () => {
    expect(() => db.prepare("UPDATE refunds SET amount_cents = 10.5 WHERE id = 'rf_1001'").run()).toThrow();
  });
});

describe("actionItemFor", () => {
  it("offers approve/reject on pending and payout only to admins on approved", () => {
    expect(actionItemFor(ava, { status: "pending" })?.intents).toEqual(["approve", "reject"]);
    expect(actionItemFor(ava, { status: "approved" })).toBeNull();
    expect(actionItemFor(sam, { status: "approved" })?.intents).toEqual(["process"]);
    expect(actionItemFor(sam, { status: "processed" })).toBeNull();
  });
});
