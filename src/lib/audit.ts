import type { DB } from "./db";
import { nowIso } from "./db";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  before: unknown;
  after: unknown;
  requestId: string;
}

export interface AuditRow {
  id: number;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  before_json: string | null;
  after_json: string | null;
  request_id: string;
}

// Must run inside the same transaction as the state change it records.
export function writeAudit(db: DB, entry: AuditEntry): void {
  if (!db.inTransaction) {
    throw new Error("writeAudit must be called inside the transaction that performs the change");
  }
  db.prepare(
    `INSERT INTO audit_log (created_at, actor_id, action, resource_type, resource_id, before_json, after_json, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nowIso(),
    entry.actorId,
    entry.action,
    entry.resourceType,
    entry.resourceId,
    entry.before == null ? null : JSON.stringify(entry.before),
    entry.after == null ? null : JSON.stringify(entry.after),
    entry.requestId,
  );
}

const AUDIT_SELECT = `
  SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id`;

export function readAuditForResource(db: DB, resourceType: string, resourceId: string): AuditRow[] {
  return db
    .prepare(`${AUDIT_SELECT} WHERE a.resource_type = ? AND a.resource_id = ? ORDER BY a.id DESC`)
    .all(resourceType, resourceId) as AuditRow[];
}

export function readRecentAudit(db: DB, limit = 200): AuditRow[] {
  return db.prepare(`${AUDIT_SELECT} ORDER BY a.id DESC LIMIT ?`).all(limit) as AuditRow[];
}
