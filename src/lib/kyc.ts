import type { DB } from "./db";
import { nowIso } from "./db";
import { readAuditForResource, writeAudit, type AuditRow } from "./audit";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { authorize, can } from "./policy";
import type { KycStatus, RiskLevel, User } from "./types";

export const KYC_STATUSES: KycStatus[] = ["pending", "in_review", "needs_info", "escalated", "approved", "rejected"];
const OPEN_STATUSES: KycStatus[] = ["pending", "in_review", "needs_info", "escalated"];
export const MAX_REASON_LENGTH = 1000;

export type KycIntent = "claim" | "release" | "request_info" | "escalate" | "approve" | "reject";
export const REASON_REQUIRED: readonly KycIntent[] = ["request_info", "escalate", "approve", "reject"];

interface CaseRow {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  status: KycStatus;
  risk_level: RiskLevel;
  assignee_id: string | null;
  assignee_name: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  sla_due_at: string;
  legal_name: string;
  date_of_birth: string;
  national_id: string;
  address_line: string;
  city: string;
  country: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface KycPii {
  dateOfBirth: string;
  nationalId: string;
  addressLine: string;
  city: string;
  country: string;
  masked: boolean;
}

export interface KycCase {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  legalName: string;
  status: KycStatus;
  riskLevel: RiskLevel;
  assigneeId: string | null;
  assigneeName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  slaDueAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  pii: KycPii;
}

export interface KycDocument {
  id: string;
  kind: string;
  file_name: string;
  status: string;
  uploaded_at: string;
}

export interface KycCheck {
  id: string;
  kind: string;
  result: "pass" | "review" | "fail";
  detail: string;
  checked_at: string;
}

export interface KycNote {
  id: number;
  kind: string;
  body: string;
  author_name: string | null;
  created_at: string;
}

export interface KycActionItem {
  label: string;
  intents: KycIntent[];
}

const SELECT_CASE = `
  SELECT k.*, c.name AS customer_name, c.email AS customer_email,
         a.name AS assignee_name, d.name AS decided_by_name
  FROM kyc_cases k
  JOIN customers c ON c.id = k.customer_id
  LEFT JOIN users a ON a.id = k.assignee_id
  LEFT JOIN users d ON d.id = k.decided_by`;

const QUEUE_ORDER = `
  ORDER BY CASE WHEN k.status IN ('approved', 'rejected') THEN 1 ELSE 0 END,
           CASE WHEN k.status IN ('approved', 'rejected') THEN NULL ELSE k.sla_due_at END,
           CASE k.risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           k.updated_at DESC`;

export const maskDateOfBirth = (dob: string) => `${dob.slice(0, 4)}-••-••`;
export const maskNationalId = (id: string) => `•••-••-${id.slice(-4)}`;
export const maskAddressLine = () => "••••••••";

// Raw PII leaves this module only for users the policy grants kyc:view_pii.
function toView(row: CaseRow, user: User): KycCase {
  const unmasked = can(user, "kyc:view_pii");
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    legalName: row.legal_name,
    status: row.status,
    riskLevel: row.risk_level,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at,
    slaDueAt: row.sla_due_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pii: {
      dateOfBirth: unmasked ? row.date_of_birth : maskDateOfBirth(row.date_of_birth),
      nationalId: unmasked ? row.national_id : maskNationalId(row.national_id),
      addressLine: unmasked ? row.address_line : maskAddressLine(),
      city: row.city,
      country: row.country,
      masked: !unmasked,
    },
  };
}

// Audit snapshots never include PII: the audit log is append-only, so it could never be scrubbed.
function snapshot(c: CaseRow) {
  return {
    status: c.status,
    riskLevel: c.risk_level,
    assigneeId: c.assignee_id,
    decidedBy: c.decided_by,
    version: c.version,
  };
}

function loadCase(db: DB, id: string): CaseRow {
  const row = db.prepare(`${SELECT_CASE} WHERE k.id = ?`).get(id) as CaseRow | undefined;
  if (!row) throw new NotFoundError(`KYC case ${id} not found`);
  return row;
}

export function isOpen(status: KycStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function slaState(c: Pick<KycCase, "status" | "slaDueAt">, now = Date.now()) {
  if (!isOpen(c.status)) return null;
  const diff = new Date(c.slaDueAt).getTime() - now;
  const hours = Math.max(1, Math.round(Math.abs(diff) / 3_600_000));
  const span = hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`;
  return diff < 0 ? { overdue: true, label: `Overdue by ${span}` } : { overdue: false, label: `Due in ${span}` };
}

export function kycActionItemFor(user: User, c: Pick<KycCase, "status" | "assigneeId">): KycActionItem | null {
  const mine = c.assigneeId === user.id;
  switch (c.status) {
    case "pending":
      return can(user, "kyc:claim") ? { label: "Claim case", intents: ["claim"] } : null;
    case "needs_info":
      if (!can(user, "kyc:claim") || (c.assigneeId && !mine)) return null;
      return { label: mine ? "Resume review once the customer replies" : "Claim case", intents: ["claim"] };
    case "in_review": {
      if (!mine) return null;
      const intents = (["approve", "reject", "request_info", "escalate"] as const).filter((i) => can(user, `kyc:${i}`));
      return { label: "Review case", intents: [...intents, "release"] };
    }
    case "escalated": {
      if (!can(user, "kyc:decide_escalated")) return null;
      const intents = (["approve", "reject"] as const).filter((i) => can(user, `kyc:${i}`));
      return intents.length ? { label: "Decide escalated case", intents } : null;
    }
    default:
      return null;
  }
}

export function kycWaitingText(c: Pick<KycCase, "status" | "assigneeName">): string {
  switch (c.status) {
    case "in_review":
      return `In review by ${c.assigneeName ?? "another reviewer"}`;
    case "needs_info":
      return `Waiting on customer (${c.assigneeName ?? "unassigned"})`;
    case "escalated":
      return "Escalated, awaiting an admin";
    case "pending":
      return "Unclaimed";
    default:
      return "No action needed";
  }
}

export function listCases(
  db: DB,
  user: User,
  filter: { status?: KycStatus; assignedToMe?: boolean } = {},
): KycCase[] {
  authorize(user, "kyc:view");
  const where: string[] = [];
  const args: string[] = [];
  if (filter.status) {
    where.push("k.status = ?");
    args.push(filter.status);
  }
  if (filter.assignedToMe) {
    where.push("k.assignee_id = ?");
    args.push(user.id);
  }
  const sql = `${SELECT_CASE} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ${QUEUE_ORDER}`;
  return (db.prepare(sql).all(...args) as CaseRow[]).map((r) => toView(r, user));
}

export function kycQueueStats(db: DB, user: User, now = new Date()) {
  authorize(user, "kyc:view");
  const counts = Object.fromEntries(KYC_STATUSES.map((s) => [s, 0])) as Record<KycStatus, number>;
  for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM kyc_cases GROUP BY status").all() as {
    status: KycStatus;
    n: number;
  }[]) {
    counts[r.status] = r.n;
  }
  const { overdue } = db
    .prepare(
      `SELECT COUNT(*) AS overdue FROM kyc_cases
       WHERE status NOT IN ('approved', 'rejected') AND sla_due_at < ?`,
    )
    .get(now.toISOString()) as { overdue: number };
  const open = OPEN_STATUSES.reduce((n, s) => n + counts[s], 0);
  return { counts, open, overdue };
}

export function listKycAssignments(db: DB, user: User): KycCase[] {
  authorize(user, "kyc:view");
  const rows = db
    .prepare(
      `${SELECT_CASE} WHERE (k.assignee_id = ? AND k.status IN ('in_review', 'needs_info')) OR k.status = 'escalated'
       ${QUEUE_ORDER}`,
    )
    .all(user.id) as CaseRow[];
  return rows.map((r) => toView(r, user)).filter((c) => kycActionItemFor(user, c));
}

export function getCase(db: DB, user: User, id: string): KycCase {
  authorize(user, "kyc:view");
  return toView(loadCase(db, id), user);
}

export function getCaseDocuments(db: DB, user: User, caseId: string): KycDocument[] {
  authorize(user, "kyc:view");
  return db
    .prepare("SELECT id, kind, file_name, status, uploaded_at FROM kyc_documents WHERE case_id = ? ORDER BY id")
    .all(caseId) as KycDocument[];
}

export function getCaseChecks(db: DB, user: User, caseId: string): KycCheck[] {
  authorize(user, "kyc:view");
  return db
    .prepare("SELECT id, kind, result, detail, checked_at FROM kyc_checks WHERE case_id = ? ORDER BY id")
    .all(caseId) as KycCheck[];
}

export function getCaseNotes(db: DB, user: User, caseId: string): KycNote[] {
  authorize(user, "kyc:view");
  return db
    .prepare(
      `SELECT n.id, n.kind, n.body, n.created_at, u.name AS author_name
       FROM kyc_notes n LEFT JOIN users u ON u.id = n.author_id
       WHERE n.case_id = ? ORDER BY n.id DESC`,
    )
    .all(caseId) as KycNote[];
}

export function getCaseHistory(db: DB, user: User, caseId: string): AuditRow[] {
  authorize(user, "kyc:view_history");
  return readAuditForResource(db, "kyc_case", caseId);
}

export interface KycInput {
  caseId: string;
  expectedVersion: number;
  requestId: string;
}

interface Transition {
  action: string;
  check: (c: CaseRow) => void;
  status: KycStatus;
  assigneeId: (c: CaseRow) => string | null;
  decided?: boolean;
  note?: { kind: "request_info" | "escalation" | "decision"; body: string };
}

const STALE = "Case was changed by someone else. Reload and try again.";

// One immediate transaction: state checks, version check, note, update and audit row commit together.
function transition(db: DB, user: User, input: KycInput, t: Transition): KycCase {
  return db
    .transaction(() => {
      const before = loadCase(db, input.caseId);
      t.check(before);
      if (before.version !== input.expectedVersion) throw new ConflictError(STALE);

      let noteId: number | null = null;
      if (t.note) {
        noteId = Number(
          db
            .prepare("INSERT INTO kyc_notes (case_id, author_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(before.id, user.id, t.note.kind, t.note.body, nowIso()).lastInsertRowid,
        );
      }

      const now = nowIso();
      const res = db
        .prepare(
          `UPDATE kyc_cases SET status = ?, assignee_id = ?, decided_by = ?, decided_at = ?,
             version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          t.status,
          t.assigneeId(before),
          t.decided ? user.id : before.decided_by,
          t.decided ? now : before.decided_at,
          now,
          before.id,
          before.version,
        );
      if (res.changes !== 1) throw new ConflictError(STALE);

      const after = loadCase(db, before.id);
      writeAudit(db, {
        actorId: user.id,
        action: t.action,
        resourceType: "kyc_case",
        resourceId: before.id,
        before: snapshot(before),
        after: { ...snapshot(after), noteId },
        requestId: input.requestId,
      });
      return toView(after, user);
    })
    .immediate();
}

function requireReason(reason: string | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new ValidationError("A reason is required");
  if (trimmed.length > MAX_REASON_LENGTH) throw new ValidationError(`Reason must be ${MAX_REASON_LENGTH} characters or fewer`);
  return trimmed;
}

function requireOwnReview(c: CaseRow, user: User) {
  if (c.status !== "in_review") throw new ConflictError(`Case is ${c.status.replace("_", " ")}, not in review`);
  if (c.assignee_id !== user.id) {
    throw new ConflictError(`Case is claimed by ${c.assignee_name ?? "another reviewer"}. Claim it before acting on it.`);
  }
}

export function claimCase(db: DB, user: User, input: KycInput): KycCase {
  authorize(user, "kyc:claim");
  return transition(db, user, input, {
    action: "kyc.claim",
    check: (c) => {
      if (c.status === "in_review") {
        throw new ConflictError(c.assignee_id === user.id ? "You already claimed this case" : `Already claimed by ${c.assignee_name}`);
      }
      if (c.status !== "pending" && c.status !== "needs_info") {
        throw new ConflictError(`Case is ${c.status.replace("_", " ")} and cannot be claimed`);
      }
      if (c.assignee_id && c.assignee_id !== user.id) throw new ConflictError(`Case is assigned to ${c.assignee_name}`);
    },
    status: "in_review",
    assigneeId: () => user.id,
  });
}

export function releaseCase(db: DB, user: User, input: KycInput): KycCase {
  authorize(user, "kyc:claim");
  return transition(db, user, input, {
    action: "kyc.release",
    check: (c) => requireOwnReview(c, user),
    status: "pending",
    assigneeId: () => null,
  });
}

export function requestInfo(db: DB, user: User, input: KycInput & { reason: string }): KycCase {
  authorize(user, "kyc:request_info");
  const body = requireReason(input.reason);
  return transition(db, user, input, {
    action: "kyc.request_info",
    check: (c) => requireOwnReview(c, user),
    status: "needs_info",
    assigneeId: () => user.id,
    note: { kind: "request_info", body },
  });
}

export function escalateCase(db: DB, user: User, input: KycInput & { reason: string }): KycCase {
  authorize(user, "kyc:escalate");
  const body = requireReason(input.reason);
  return transition(db, user, input, {
    action: "kyc.escalate",
    check: (c) => requireOwnReview(c, user),
    status: "escalated",
    assigneeId: () => null,
    note: { kind: "escalation", body },
  });
}

export function decideCase(
  db: DB,
  user: User,
  input: KycInput & { decision: "approve" | "reject"; reason: string },
): KycCase {
  authorize(user, input.decision === "approve" ? "kyc:approve" : "kyc:reject");
  const reason = requireReason(input.reason);
  return transition(db, user, input, {
    action: `kyc.${input.decision}`,
    check: (c) => {
      if (c.status === "escalated") authorize(user, "kyc:decide_escalated");
      else requireOwnReview(c, user);
    },
    status: input.decision === "approve" ? "approved" : "rejected",
    assigneeId: (c) => c.assignee_id ?? user.id,
    decided: true,
    note: { kind: "decision", body: `${input.decision === "approve" ? "Approved" : "Rejected"}: ${reason}` },
  });
}
