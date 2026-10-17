import { randomUUID } from "node:crypto";
import type { DB } from "./db";
import { nowIso } from "./db";
import { writeAudit } from "./audit";
import { InsufficientFundsError } from "./errors";

export interface LedgerEntryInput {
  accountId: string;
  amountCents: number;
}

export interface LedgerEntryRow {
  id: number;
  txn_id: string;
  account_id: string;
  account_name: string;
  amount_cents: number;
}

// Double-entry: signed amounts (debit > 0, credit < 0) must sum to zero.
// Must run inside a transaction so the entries, balance checks and audit row commit atomically.
export function postLedgerTransaction(
  db: DB,
  input: { description: string; entries: LedgerEntryInput[]; actorId: string | null; requestId: string },
): string {
  if (!db.inTransaction) throw new Error("postLedgerTransaction must run inside a transaction");
  const { entries } = input;
  if (entries.length < 2) throw new Error("A ledger transaction needs at least two entries");
  for (const e of entries) {
    if (!Number.isSafeInteger(e.amountCents) || e.amountCents === 0) {
      throw new Error("Ledger amounts must be non-zero integer minor units");
    }
  }
  if (entries.reduce((sum, e) => sum + e.amountCents, 0) !== 0) {
    throw new Error("Ledger transaction is unbalanced: debits must equal credits");
  }

  const txnId = `txn_${randomUUID()}`;
  db.prepare("INSERT INTO ledger_transactions (id, description, created_at) VALUES (?, ?, ?)").run(
    txnId,
    input.description,
    nowIso(),
  );
  const insert = db.prepare("INSERT INTO ledger_entries (txn_id, account_id, amount_cents) VALUES (?, ?, ?)");
  for (const e of entries) insert.run(txnId, e.accountId, e.amountCents);

  for (const accountId of new Set(entries.map((e) => e.accountId))) {
    const account = db.prepare("SELECT allow_negative FROM ledger_accounts WHERE id = ?").get(accountId) as
      | { allow_negative: number }
      | undefined;
    if (!account) throw new Error(`Unknown ledger account ${accountId}`);
    if (!account.allow_negative && accountBalance(db, accountId) < 0) {
      throw new InsufficientFundsError(`Insufficient funds in ${accountId}`);
    }
  }

  writeAudit(db, {
    actorId: input.actorId,
    action: "ledger.post",
    resourceType: "ledger_transaction",
    resourceId: txnId,
    before: null,
    after: { description: input.description, entries },
    requestId: input.requestId,
  });
  return txnId;
}

export function accountBalance(db: DB, accountId: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS balance FROM ledger_entries WHERE account_id = ?")
    .get(accountId) as { balance: number };
  return row.balance;
}

export function readLedgerEntries(db: DB, txnId: string): LedgerEntryRow[] {
  return db
    .prepare(
      `SELECT e.*, a.name AS account_name FROM ledger_entries e
       JOIN ledger_accounts a ON a.id = e.account_id WHERE e.txn_id = ? ORDER BY e.id`,
    )
    .all(txnId) as LedgerEntryRow[];
}
