import type { DB } from "./db";
import { nowIso } from "./db";
import { readAuditForResource, writeAudit, type AuditRow } from "./audit";
import { REFUND_RESERVE_ACCOUNT, customerAccountId } from "./db/seed";
import { ConflictError, NotFoundError, PayoutBlockedError } from "./errors";
import { postLedgerTransaction, readLedgerEntries, type LedgerEntryRow } from "./ledger";
import { authorize, can } from "./policy";
import type { KycStatus, RefundStatus, User } from "./types";

export interface RefundRow {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  order_ref: string;
  amount_cents: number;
  currency: string;
  reason: string;
  status: RefundStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  decided_by_name: string | null;
  processed_by_name: string | null;
  ledger_txn_id: string | null;
  kyc_status: KycStatus | null;
  kyc_case_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export type RefundIntent = "approve" | "reject" | "process";

export interface ActionItem {
  label: string;
  intents: RefundIntent[];
}

// The customer's KYC status comes from their most recent KYC case.
const LATEST_KYC = `FROM kyc_cases k WHERE k.customer_id = r.customer_id ORDER BY k.created_at DESC, k.rowid DESC LIMIT 1`;

const SELECT_REFUND = `
  SELECT r.*, c.name AS customer_name, c.email AS customer_email,
         a.name AS assignee_name, d.name AS decided_by_name, p.name AS processed_by_name,
         (SELECT k.status ${LATEST_KYC}) AS kyc_status, (SELECT k.id ${LATEST_KYC}) AS kyc_case_id
  FROM refunds r
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN users a ON a.id = r.assignee_id
  LEFT JOIN users d ON d.id = r.decided_by
  LEFT JOIN users p ON p.id = r.processed_by`;

function loadRefund(db: DB, id: string): RefundRow {
  const row = db.prepare(`${SELECT_REFUND} WHERE r.id = ?`).get(id) as RefundRow | undefined;
  if (!row) throw new NotFoundError(`Refund ${id} not found`);
  return row;
}

function snapshot(r: RefundRow) {
  return {
    status: r.status,
    version: r.version,
    amountCents: r.amount_cents,
    decidedBy: r.decided_by_name,
    processedBy: r.processed_by_name,
    ledgerTxnId: r.ledger_txn_id,
    kycStatus: r.kyc_status,
  };
}

// Why an approved refund cannot be paid out yet, or null if nothing blocks it.
export function payoutBlockedReason(refund: Pick<RefundRow, "status" | "kyc_status">): string | null {
  if (refund.status !== "approved" || refund.kyc_status === "approved") return null;
  return refund.kyc_status
    ? `Payout blocked: customer KYC is ${refund.kyc_status.replace("_", " ")}, not approved`
    : "Payout blocked: customer has no KYC on file";
}

export function actionItemFor(user: User, refund: Pick<RefundRow, "status" | "kyc_status">): ActionItem | null {
  if (refund.status === "pending") {
    const intents = (["approve", "reject"] as const).filter((i) => can(user, `refund:${i}`));
    return intents.length ? { label: "Review refund request", intents } : null;
  }
  if (refund.status === "approved" && can(user, "refund:process") && !payoutBlockedReason(refund)) {
    return { label: "Issue refund payout", intents: ["process"] };
  }
  return null;
}

export function listRefunds(
  db: DB,
  user: User,
  filter: { status?: RefundStatus; customerId?: string } = {},
): RefundRow[] {
  authorize(user, "refund:view");
  const where: string[] = [];
  const args: string[] = [];
  if (filter.status) {
    where.push("r.status = ?");
    args.push(filter.status);
  }
  if (filter.customerId) {
    where.push("r.customer_id = ?");
    args.push(filter.customerId);
  }
  return db
    .prepare(`${SELECT_REFUND} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.created_at DESC`)
    .all(...args) as RefundRow[];
}

export function countRefundsByStatus(db: DB, user: User): Record<RefundStatus, number> {
  authorize(user, "refund:view");
  const counts: Record<RefundStatus, number> = { pending: 0, approved: 0, rejected: 0, processed: 0 };
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM refunds GROUP BY status").all() as {
    status: RefundStatus;
    n: number;
  }[];
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

export function listAssignments(db: DB, user: User): RefundRow[] {
  authorize(user, "refund:view");
  const rows = db
    .prepare(`${SELECT_REFUND} WHERE r.assignee_id = ? ORDER BY r.created_at DESC`)
    .all(user.id) as RefundRow[];
  return rows.filter((r) => actionItemFor(user, r));
}

export function getRefund(db: DB, user: User, id: string): RefundRow {
  authorize(user, "refund:view");
  return loadRefund(db, id);
}

export function getRefundHistory(db: DB, user: User, id: string): AuditRow[] {
  authorize(user, "refund:view_history");
  return readAuditForResource(db, "refund", id);
}

export function getRefundLedgerEntries(db: DB, user: User, refund: RefundRow): LedgerEntryRow[] {
  authorize(user, "refund:view");
  return refund.ledger_txn_id ? readLedgerEntries(db, refund.ledger_txn_id) : [];
}

export function decideRefund(
  db: DB,
  user: User,
  input: { refundId: string; decision: "approve" | "reject"; expectedVersion: number; requestId: string },
): RefundRow {
  authorize(user, input.decision === "approve" ? "refund:approve" : "refund:reject");
  return db
    .transaction(() => {
      const before = loadRefund(db, input.refundId);
      if (before.status !== "pending") throw new ConflictError(`Refund is ${before.status}, not pending`);
      if (before.version !== input.expectedVersion) {
        throw new ConflictError("Refund was changed by someone else. Reload and try again.");
      }
      const res = db
        .prepare(
          `UPDATE refunds SET status = ?, decided_by = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(input.decision === "approve" ? "approved" : "rejected", user.id, nowIso(), before.id, before.version);
      if (res.changes !== 1) throw new ConflictError("Refund was changed by someone else. Reload and try again.");
      const after = loadRefund(db, before.id);
      writeAudit(db, {
        actorId: user.id,
        action: `refund.${input.decision}`,
        resourceType: "refund",
        resourceId: before.id,
        before: snapshot(before),
        after: snapshot(after),
        requestId: input.requestId,
      });
      return after;
    })
    .immediate();
}

export interface ProcessResult {
  refundId: string;
  ledgerTxnId: string;
  replayed: boolean;
}

// Money-moving: idempotent, atomic (ledger + refund + audit), version-checked, and serialized
// with BEGIN IMMEDIATE so concurrent payouts cannot overdraw the reserve. The customer's KYC status
// is read inside the same transaction, so a concurrent KYC decision cannot slip past the gate.
export function processRefund(
  db: DB,
  user: User,
  input: { refundId: string; expectedVersion: number; idempotencyKey: string; requestId: string },
): ProcessResult {
  authorize(user, "refund:process");
  if (!input.idempotencyKey) throw new ConflictError("An idempotency key is required");
  return db
    .transaction((): ProcessResult => {
      const prior = db.prepare("SELECT * FROM idempotency_keys WHERE key = ?").get(input.idempotencyKey) as
        | { actor_id: string; action: string; resource_id: string; result_json: string }
        | undefined;
      if (prior) {
        if (prior.actor_id !== user.id || prior.action !== "refund.process" || prior.resource_id !== input.refundId) {
          throw new ConflictError("Idempotency key was already used for a different request");
        }
        return { ...(JSON.parse(prior.result_json) as Omit<ProcessResult, "replayed">), replayed: true };
      }

      const before = loadRefund(db, input.refundId);
      if (before.status !== "approved") throw new ConflictError(`Refund is ${before.status}, not approved`);
      if (before.version !== input.expectedVersion) {
        throw new ConflictError("Refund was changed by someone else. Reload and try again.");
      }
      const blocked = payoutBlockedReason(before);
      if (blocked) throw new PayoutBlockedError(blocked);

      const ledgerTxnId = postLedgerTransaction(db, {
        description: `Refund ${before.id} payout`,
        entries: [
          { accountId: REFUND_RESERVE_ACCOUNT, amountCents: -before.amount_cents },
          { accountId: customerAccountId(before.customer_id), amountCents: before.amount_cents },
        ],
        actorId: user.id,
        requestId: input.requestId,
      });

      const res = db
        .prepare(
          `UPDATE refunds SET status = 'processed', processed_by = ?, ledger_txn_id = ?,
             version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(user.id, ledgerTxnId, nowIso(), before.id, before.version);
      if (res.changes !== 1) throw new ConflictError("Refund was changed by someone else. Reload and try again.");

      const after = loadRefund(db, before.id);
      writeAudit(db, {
        actorId: user.id,
        action: "refund.process",
        resourceType: "refund",
        resourceId: before.id,
        before: snapshot(before),
        after: snapshot(after),
        requestId: input.requestId,
      });

      const result = { refundId: before.id, ledgerTxnId };
      db.prepare(
        "INSERT INTO idempotency_keys (key, actor_id, action, resource_id, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(input.idempotencyKey, user.id, "refund.process", before.id, JSON.stringify(result), nowIso());
      return { ...result, replayed: false };
    })
    .immediate();
}
