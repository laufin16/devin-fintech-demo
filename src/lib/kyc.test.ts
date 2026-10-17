import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type DB } from "./db";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import {
  claimCase,
  decideCase,
  escalateCase,
  getCase,
  kycActionItemFor,
  listCases,
  listKycAssignments,
  releaseCase,
  requestInfo,
} from "./kyc";
import type { User } from "./types";

const ava: User = { id: "u_ava", email: "ava@acme.dev", name: "Ava Approver", role: "approver" };
const ben: User = { id: "u_ben", email: "ben@acme.dev", name: "Ben Approver", role: "approver" };
const sam: User = { id: "u_sam", email: "sam@acme.dev", name: "Sam Admin", role: "admin" };

let db: DB;
const auditCount = () => (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
const lastAudit = () =>
  db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1").get() as Record<string, string>;
const version = (id: string) => getCase(db, sam, id).version;
const input = (caseId: string) => ({ caseId, expectedVersion: version(caseId), requestId: "req-k" });

beforeEach(() => {
  db = createDb(":memory:");
});

describe("seed", () => {
  it("creates KYC cases for every refund customer and writes a seed audit row", () => {
    expect(listCases(db, sam)).toHaveLength(8);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'system.seed_kyc'").get()).toEqual({ n: 1 });
  });
});

describe("PII masking", () => {
  it("masks PII for approvers", () => {
    const c = getCase(db, ava, "kyc_2001");
    expect(c.pii).toMatchObject({ dateOfBirth: "1988-••-••", nationalId: "•••-••-4821", addressLine: "••••••••", masked: true });
    expect(JSON.stringify(listCases(db, ava))).not.toContain("900-12-4821");
  });

  it("shows unmasked PII to admins only", () => {
    expect(getCase(db, sam, "kyc_2001").pii).toMatchObject({
      dateOfBirth: "1988-04-15",
      nationalId: "900-12-4821",
      addressLine: "18 Elm Street",
      masked: false,
    });
  });
});

describe("queue", () => {
  it("puts open cases first, ordered by SLA", () => {
    const cases = listCases(db, ava);
    const open = cases.filter((c) => !["approved", "rejected"].includes(c.status));
    expect(cases.slice(0, open.length)).toEqual(open);
    const due = open.map((c) => c.slaDueAt);
    expect(due).toEqual([...due].sort());
  });

  it("lists my claimed cases as assignments, and escalated cases only for admins", () => {
    expect(listKycAssignments(db, ava).map((c) => c.id)).toEqual(["kyc_2006"]);
    expect(listKycAssignments(db, ben).map((c) => c.id)).toEqual(["kyc_2005"]);
    expect(listKycAssignments(db, sam).map((c) => c.id)).toEqual(["kyc_2007"]);
  });
});

describe("claiming", () => {
  it("claims a pending case and audits it without PII", () => {
    const before = auditCount();
    const c = claimCase(db, ava, input("kyc_2008"));
    expect(c).toMatchObject({ status: "in_review", assigneeId: "u_ava" });
    expect(auditCount()).toBe(before + 1);
    const row = lastAudit();
    expect(row).toMatchObject({ action: "kyc.claim", resource_type: "kyc_case", resource_id: "kyc_2008", request_id: "req-k" });
    expect(JSON.parse(row.before_json).status).toBe("pending");
    expect(JSON.parse(row.after_json)).toMatchObject({ status: "in_review", assigneeId: "u_ava" });
    expect(row.before_json + row.after_json).not.toMatch(/900-87-5530|2001-03-27|College Ave/);
  });

  it("stops a second reviewer from claiming the same case", () => {
    const v = version("kyc_2008");
    claimCase(db, ava, { caseId: "kyc_2008", expectedVersion: v, requestId: "r" });
    expect(() => claimCase(db, ben, input("kyc_2008"))).toThrow(/Already claimed by Ava/);
    // Two tabs submitting the same version: the second loses on the status check.
    expect(() => claimCase(db, ben, { caseId: "kyc_2008", expectedVersion: v, requestId: "r" })).toThrow(ConflictError);
  });

  it("rejects stale versions without writing anything", () => {
    const before = auditCount();
    expect(() => claimCase(db, ava, { caseId: "kyc_2008", expectedVersion: 99, requestId: "r" })).toThrow(/changed by someone else/);
    expect(getCase(db, ava, "kyc_2008").status).toBe("pending");
    expect(auditCount()).toBe(before);
  });

  it("lets only the assignee resume a needs-info case", () => {
    expect(() => claimCase(db, ava, input("kyc_2005"))).toThrow(/assigned to Ben/);
    expect(claimCase(db, ben, input("kyc_2005")).status).toBe("in_review");
  });

  it("releases a claimed case back to the queue", () => {
    expect(() => releaseCase(db, ben, input("kyc_2006"))).toThrow(/claimed by Ava/);
    expect(releaseCase(db, ava, input("kyc_2006"))).toMatchObject({ status: "pending", assigneeId: null });
  });
});

describe("review actions", () => {
  it("requires a reason, stored as an append-only note referenced from the audit row", () => {
    expect(() => decideCase(db, ava, { ...input("kyc_2006"), decision: "approve", reason: "  " })).toThrow(ValidationError);
    const c = decideCase(db, ava, { ...input("kyc_2006"), decision: "approve", reason: "Lease confirms new address" });
    expect(c).toMatchObject({ status: "approved", decidedByName: "Ava Approver" });
    const after = JSON.parse(lastAudit().after_json);
    expect(after.noteId).toBeTypeOf("number");
    const note = db.prepare("SELECT * FROM kyc_notes WHERE id = ?").get(after.noteId) as { body: string; kind: string };
    expect(note).toMatchObject({ kind: "decision", body: "Approved: Lease confirms new address" });
    expect(() => db.prepare("UPDATE kyc_notes SET body = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM kyc_notes").run()).toThrow(/append-only/);
  });

  it("only lets the assignee act on an in-review case", () => {
    expect(() => decideCase(db, ben, { ...input("kyc_2006"), decision: "reject", reason: "x" })).toThrow(/claimed by Ava/);
    expect(() => decideCase(db, ava, { ...input("kyc_2008"), decision: "approve", reason: "x" })).toThrow(/not in review/);
  });

  it("requests info, then the assignee resumes", () => {
    expect(requestInfo(db, ava, { ...input("kyc_2006"), reason: "Need a lease" })).toMatchObject({
      status: "needs_info",
      assigneeId: "u_ava",
    });
    expect(claimCase(db, ava, input("kyc_2006")).status).toBe("in_review");
  });

  it("escalated cases can only be decided by admins", () => {
    escalateCase(db, ava, { ...input("kyc_2006"), reason: "Address mismatch I can't resolve" });
    expect(getCase(db, sam, "kyc_2006")).toMatchObject({ status: "escalated", assigneeId: null });
    expect(kycActionItemFor(ava, getCase(db, ava, "kyc_2006"))).toBeNull();
    expect(() => decideCase(db, ava, { ...input("kyc_2006"), decision: "approve", reason: "x" })).toThrow(ForbiddenError);
    expect(decideCase(db, sam, { ...input("kyc_2006"), decision: "reject", reason: "Unverifiable" })).toMatchObject({
      status: "rejected",
      assigneeId: "u_sam",
    });
  });

  it("decided cases are final", () => {
    expect(() => claimCase(db, ava, input("kyc_2001"))).toThrow(/cannot be claimed/);
    expect(() => decideCase(db, sam, { ...input("kyc_2001"), decision: "reject", reason: "x" })).toThrow(ConflictError);
  });

  it("rolls back the change and note if the audit write fails", () => {
    const notes = (db.prepare("SELECT COUNT(*) AS n FROM kyc_notes").get() as { n: number }).n;
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END;");
    expect(() => decideCase(db, ava, { ...input("kyc_2006"), decision: "approve", reason: "ok" })).toThrow(/audit down/);
    expect(getCase(db, ava, "kyc_2006").status).toBe("in_review");
    expect((db.prepare("SELECT COUNT(*) AS n FROM kyc_notes").get() as { n: number }).n).toBe(notes);
  });
});
