import type { DB } from "./index";
import { writeAudit } from "../audit";
import { customerAccountId } from "./seed";
import type { KycStatus, RiskLevel } from "../types";

const extraCustomers = [
  { id: "c_6", name: "Noah Kim", email: "noah.kim@example.com" },
  { id: "c_7", name: "Fatima Al-Sayed", email: "fatima.alsayed@example.com" },
  { id: "c_8", name: "Lucas Martin", email: "lucas.martin@example.com" },
];

type CheckKind = "id_verification" | "sanctions" | "pep" | "address";
type Check = { result: "pass" | "review" | "fail"; detail: string };

type SeedCase = {
  id: string;
  customer: string;
  legalName: string;
  status: KycStatus;
  risk: RiskLevel;
  assignee?: string;
  decidedBy?: string;
  hoursAgo: number;
  dob: string;
  nationalId: string;
  address: string;
  city: string;
  country: string;
  idDoc: "passport" | "drivers_license";
  proofOfAddress?: "verified" | "unverified" | "expired";
  checks?: Partial<Record<CheckKind, Check>>;
  notes?: { kind: "request_info" | "escalation" | "decision"; author: string; body: string }[];
};

// Mock PII only. National IDs use the never-issued 9xx SSN range.
const cases: SeedCase[] = [
  { id: "kyc_2001", customer: "c_1", legalName: "Jordan Lee", status: "approved", risk: "low", assignee: "u_sam", decidedBy: "u_sam", hoursAgo: 240, dob: "1988-04-15", nationalId: "900-12-4821", address: "18 Elm Street", city: "Portland", country: "US", idDoc: "drivers_license", notes: [{ kind: "decision", author: "u_sam", body: "Approved: all checks passed." }] },
  { id: "kyc_2002", customer: "c_2", legalName: "Priya Patel", status: "approved", risk: "medium", assignee: "u_ava", decidedBy: "u_ava", hoursAgo: 192, dob: "1992-11-02", nationalId: "900-34-1177", address: "402 Market Ave, Apt 9", city: "San Jose", country: "US", idDoc: "passport", notes: [{ kind: "decision", author: "u_ava", body: "Approved: address mismatch explained by recent move, lease provided." }] },
  { id: "kyc_2003", customer: "c_3", legalName: "Marcus Chen", status: "approved", risk: "low", assignee: "u_ben", decidedBy: "u_ben", hoursAgo: 168, dob: "1979-07-23", nationalId: "900-56-3390", address: "77 Harbor Road", city: "Seattle", country: "US", idDoc: "passport", notes: [{ kind: "decision", author: "u_ben", body: "Approved: all checks passed." }] },
  { id: "kyc_2004", customer: "c_4", legalName: "Elena Garcia Ruiz", status: "pending", risk: "high", hoursAgo: 30, dob: "1985-02-09", nationalId: "900-78-6612", address: "1200 Ocean Drive", city: "Miami", country: "US", idDoc: "passport", checks: { sanctions: { result: "review", detail: "Possible name match on a sanctions list (score 0.82). Different date of birth on file." } } },
  { id: "kyc_2005", customer: "c_5", legalName: "Thomas Okafor", status: "needs_info", risk: "low", assignee: "u_ben", hoursAgo: 80, dob: "1995-09-30", nationalId: "900-21-0458", address: "9 Birch Lane", city: "Austin", country: "US", idDoc: "drivers_license", proofOfAddress: "expired", checks: { address: { result: "review", detail: "Proof of address is older than 90 days." } }, notes: [{ kind: "request_info", author: "u_ben", body: "Proof of address is older than 90 days. Asked the customer for a recent utility bill." }] },
  { id: "kyc_2006", customer: "c_6", legalName: "Noah Kim", status: "in_review", risk: "medium", assignee: "u_ava", hoursAgo: 20, dob: "1990-12-12", nationalId: "900-43-7781", address: "55 Pine Street", city: "Chicago", country: "US", idDoc: "drivers_license", proofOfAddress: "unverified", checks: { address: { result: "review", detail: "Address on ID does not match the address provided." } } },
  { id: "kyc_2007", customer: "c_7", legalName: "Fatima Al-Sayed", status: "escalated", risk: "high", hoursAgo: 50, dob: "1974-05-18", nationalId: "900-65-2204", address: "3 Crescent Court", city: "Dearborn", country: "US", idDoc: "passport", checks: { pep: { result: "review", detail: "Politically exposed person: listed as a current municipal official." } }, notes: [{ kind: "escalation", author: "u_ben", body: "PEP match on a current municipal official. Needs an admin decision." }] },
  { id: "kyc_2008", customer: "c_8", legalName: "Lucas Martin", status: "pending", risk: "low", hoursAgo: 4, dob: "2001-03-27", nationalId: "900-87-5530", address: "210 College Ave", city: "Boston", country: "US", idDoc: "passport" },
];

const SLA_HOURS: Record<RiskLevel, number> = { high: 24, medium: 48, low: 72 };

// Inserts the KYC demo data. Runs on fresh databases and on databases created before the KYC queue
// existed (otherwise every refund payout would be blocked). Must run inside a transaction.
export function seedKyc(db: DB, requestId: string): void {
  const now = Date.now();
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();

  const insertCustomer = db.prepare("INSERT OR IGNORE INTO customers (id, name, email) VALUES (?, ?, ?)");
  const insertAccount = db.prepare(
    "INSERT OR IGNORE INTO ledger_accounts (id, name, kind, allow_negative) VALUES (?, ?, 'customer', 0)",
  );
  for (const c of extraCustomers) {
    insertCustomer.run(c.id, c.name, c.email);
    insertAccount.run(customerAccountId(c.id), `Customer ${c.name}`);
  }

  const insertCase = db.prepare(
    `INSERT INTO kyc_cases (id, customer_id, status, risk_level, assignee_id, decided_by, decided_at, sla_due_at,
       legal_name, date_of_birth, national_id, address_line, city, country, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDoc = db.prepare(
    "INSERT INTO kyc_documents (id, case_id, kind, file_name, status, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertCheck = db.prepare(
    "INSERT INTO kyc_checks (id, case_id, kind, result, detail, checked_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertNote = db.prepare(
    "INSERT INTO kyc_notes (case_id, author_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)",
  );

  const defaultChecks: Record<CheckKind, Check> = {
    id_verification: { result: "pass", detail: "Document authentic; selfie matches photo." },
    sanctions: { result: "pass", detail: "No sanctions list matches." },
    pep: { result: "pass", detail: "Not a politically exposed person." },
    address: { result: "pass", detail: "Address verified against proof of address." },
  };

  for (const c of cases) {
    const created = iso(c.hoursAgo);
    const updated = iso(Math.max(c.hoursAgo - 2, 0));
    const decided = c.decidedBy ? updated : null;
    const sla = new Date(now - c.hoursAgo * 3_600_000 + SLA_HOURS[c.risk] * 3_600_000).toISOString();
    const version = 1 + (c.assignee ? 1 : 0) + (c.notes?.length ?? 0);
    insertCase.run(
      c.id, c.customer, c.status, c.risk, c.assignee ?? null, c.decidedBy ?? null, decided, sla,
      c.legalName, c.dob, c.nationalId, c.address, c.city, c.country, version, created, updated,
    );
    insertDoc.run(`${c.id}_id`, c.id, c.idDoc, `${c.idDoc}_front.jpg`, "verified", created);
    insertDoc.run(`${c.id}_poa`, c.id, "proof_of_address", "utility_bill.pdf", c.proofOfAddress ?? "verified", created);
    insertDoc.run(`${c.id}_selfie`, c.id, "selfie", "selfie.jpg", "verified", created);
    for (const kind of Object.keys(defaultChecks) as CheckKind[]) {
      const check = c.checks?.[kind] ?? defaultChecks[kind];
      insertCheck.run(`${c.id}_${kind}`, c.id, kind, check.result, check.detail, created);
    }
    for (const n of c.notes ?? []) insertNote.run(c.id, n.author, n.kind, n.body, updated);
  }

  writeAudit(db, {
    actorId: null,
    action: "system.seed_kyc",
    resourceType: "system",
    resourceId: "seed_kyc",
    before: null,
    after: { customers: extraCustomers.length, kycCases: cases.length },
    requestId,
  });
}
