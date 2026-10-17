// Money is always stored as INTEGER minor units (cents).
// audit_log, ledger_transactions, ledger_entries, kyc_notes and slack_messages are append-only, enforced by triggers.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('approver', 'admin')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('equity', 'reserve', 'customer')),
  allow_negative INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative IN (0, 1))
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Signed amounts: positive = debit, negative = credit. Each transaction's entries sum to zero.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT NOT NULL REFERENCES ledger_transactions(id),
  account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents <> 0)
);
CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries(account_id);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  order_ref TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'processed')),
  assignee_id TEXT REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  processed_by TEXT REFERENCES users(id),
  ledger_txn_id TEXT REFERENCES ledger_transactions(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- KYC review. PII (date_of_birth, national_id, address_line) lives only here and is never copied
-- into audit_log; non-admins only ever receive masked values.
CREATE TABLE IF NOT EXISTS kyc_cases (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_review', 'needs_info', 'escalated', 'approved', 'rejected')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  assignee_id TEXT REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  sla_due_at TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  national_id TEXT NOT NULL,
  address_line TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kyc_cases_customer ON kyc_cases(customer_id, created_at);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES kyc_cases(id),
  kind TEXT NOT NULL CHECK (kind IN ('passport', 'drivers_license', 'proof_of_address', 'selfie')),
  file_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'unverified', 'expired')),
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kyc_checks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES kyc_cases(id),
  kind TEXT NOT NULL CHECK (kind IN ('id_verification', 'sanctions', 'pep', 'address')),
  result TEXT NOT NULL CHECK (result IN ('pass', 'review', 'fail')),
  detail TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kyc_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES kyc_cases(id),
  author_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('request_info', 'escalation', 'decision', 'system')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kyc_notes_case ON kyc_notes(case_id);

-- Mock Slack outbox: messages are recorded here instead of being sent to a real workspace.
CREATE TABLE IF NOT EXISTS slack_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS slack_messages_resource ON slack_messages(resource_type, resource_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_log_action ON audit_log(action, resource_id);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS kyc_notes_no_update BEFORE UPDATE ON kyc_notes
BEGIN SELECT RAISE(ABORT, 'kyc_notes is append-only'); END;
CREATE TRIGGER IF NOT EXISTS kyc_notes_no_delete BEFORE DELETE ON kyc_notes
BEGIN SELECT RAISE(ABORT, 'kyc_notes is append-only'); END;
CREATE TRIGGER IF NOT EXISTS slack_messages_no_update BEFORE UPDATE ON slack_messages
BEGIN SELECT RAISE(ABORT, 'slack_messages is append-only'); END;
CREATE TRIGGER IF NOT EXISTS slack_messages_no_delete BEFORE DELETE ON slack_messages
BEGIN SELECT RAISE(ABORT, 'slack_messages is append-only'); END;

CREATE TRIGGER IF NOT EXISTS ledger_transactions_no_update BEFORE UPDATE ON ledger_transactions
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_transactions_no_delete BEFORE DELETE ON ledger_transactions
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
`;
