import type { DB } from "./index";
import { hashPassword } from "../auth/password";
import { writeAudit } from "../audit";
import { postLedgerTransaction } from "../ledger";

export const DEMO_PASSWORD = "demo1234";
export const REFUND_RESERVE_ACCOUNT = "reserve:refunds";
export const customerAccountId = (customerId: string) => `customer:${customerId}`;

const users = [
  { id: "u_ava", email: "ava@acme.dev", name: "Ava Approver", role: "approver" },
  { id: "u_ben", email: "ben@acme.dev", name: "Ben Approver", role: "approver" },
  { id: "u_sam", email: "sam@acme.dev", name: "Sam Admin", role: "admin" },
] as const;

const customers = [
  { id: "c_1", name: "Jordan Lee", email: "jordan.lee@example.com" },
  { id: "c_2", name: "Priya Patel", email: "priya.patel@example.com" },
  { id: "c_3", name: "Marcus Chen", email: "marcus.chen@example.com" },
  { id: "c_4", name: "Elena Garcia", email: "elena.garcia@example.com" },
  { id: "c_5", name: "Tom Okafor", email: "tom.okafor@example.com" },
];

type SeedRefund = {
  id: string;
  customer: string;
  order: string;
  cents: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "processed";
  assignee: string;
  decidedBy?: string;
  processedBy?: string;
  daysAgo: number;
};

const refunds: SeedRefund[] = [
  { id: "rf_1001", customer: "c_1", order: "ORD-58231", cents: 4999, reason: "Duplicate charge on card", status: "pending", assignee: "u_ava", daysAgo: 0 },
  { id: "rf_1002", customer: "c_2", order: "ORD-58302", cents: 12900, reason: "Item arrived damaged", status: "pending", assignee: "u_ava", daysAgo: 1 },
  { id: "rf_1003", customer: "c_3", order: "ORD-57990", cents: 2500, reason: "Subscription cancelled within trial", status: "approved", assignee: "u_sam", decidedBy: "u_ava", daysAgo: 2 },
  { id: "rf_1004", customer: "c_4", order: "ORD-58011", cents: 89000, reason: "Service outage SLA credit", status: "pending", assignee: "u_ben", daysAgo: 2 },
  { id: "rf_1005", customer: "c_5", order: "ORD-57744", cents: 1599, reason: "Requested after 30-day window", status: "rejected", assignee: "u_ben", decidedBy: "u_ben", daysAgo: 4 },
  { id: "rf_1006", customer: "c_1", order: "ORD-57612", cents: 7450, reason: "Wrong size shipped", status: "processed", assignee: "u_sam", decidedBy: "u_ava", processedBy: "u_sam", daysAgo: 6 },
  { id: "rf_1007", customer: "c_2", order: "ORD-58350", cents: 31000, reason: "Fraudulent transaction reported", status: "approved", assignee: "u_sam", decidedBy: "u_ben", daysAgo: 1 },
  { id: "rf_1008", customer: "c_3", order: "ORD-58377", cents: 650, reason: "Shipping fee charged twice", status: "pending", assignee: "u_sam", daysAgo: 0 },
];

export function seed(db: DB): void {
  const requestId = "seed";
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

  db.transaction(() => {
    const insertUser = db.prepare(
      "INSERT INTO users (id, email, name, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const u of users) {
      const { salt, hash } = hashPassword(DEMO_PASSWORD);
      insertUser.run(u.id, u.email, u.name, u.role, salt, hash);
    }

    const insertCustomer = db.prepare("INSERT INTO customers (id, name, email) VALUES (?, ?, ?)");
    const insertAccount = db.prepare(
      "INSERT INTO ledger_accounts (id, name, kind, allow_negative) VALUES (?, ?, ?, ?)",
    );
    insertAccount.run("equity:opening", "Opening equity", "equity", 1);
    insertAccount.run(REFUND_RESERVE_ACCOUNT, "Refund reserve", "reserve", 0);
    for (const c of customers) {
      insertCustomer.run(c.id, c.name, c.email);
      insertAccount.run(customerAccountId(c.id), `Customer ${c.name}`, "customer", 0);
    }

    postLedgerTransaction(db, {
      description: "Fund refund reserve",
      entries: [
        { accountId: REFUND_RESERVE_ACCOUNT, amountCents: 5_000_000 },
        { accountId: "equity:opening", amountCents: -5_000_000 },
      ],
      actorId: null,
      requestId,
    });

    const insertRefund = db.prepare(
      `INSERT INTO refunds (id, customer_id, order_ref, amount_cents, reason, status, assignee_id,
         decided_by, processed_by, ledger_txn_id, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of refunds) {
      let txnId: string | null = null;
      if (r.status === "processed") {
        txnId = postLedgerTransaction(db, {
          description: `Refund ${r.id} payout`,
          entries: [
            { accountId: REFUND_RESERVE_ACCOUNT, amountCents: -r.cents },
            { accountId: customerAccountId(r.customer), amountCents: r.cents },
          ],
          actorId: r.processedBy ?? null,
          requestId,
        });
      }
      const version = 1 + (r.decidedBy ? 1 : 0) + (r.processedBy ? 1 : 0);
      insertRefund.run(
        r.id, r.customer, r.order, r.cents, r.reason, r.status, r.assignee,
        r.decidedBy ?? null, r.processedBy ?? null, txnId, version, iso(r.daysAgo), iso(r.daysAgo),
      );
    }

    writeAudit(db, {
      actorId: null,
      action: "system.seed",
      resourceType: "system",
      resourceId: "seed",
      before: null,
      after: { users: users.length, customers: customers.length, refunds: refunds.length },
      requestId,
    });
  })();
}
