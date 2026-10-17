# devin-fintech-demo
Demo of Devin for a fintech startup: a prototype internal developer-tools platform.

See [AGENTS.md](AGENTS.md) for the mandatory requirements every app must follow.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # vitest
npm run lint && npm run typecheck
```

A SQLite database is created and seeded at `data/app.db` on first request (override with `DATABASE_PATH`). Delete it to reset.

Mock accounts (password `demo1234`):

| Email | Role |
| --- | --- |
| ava@acme.dev | approver |
| ben@acme.dev | approver |
| sam@acme.dev | admin |

## Where things live

- `src/lib/policy.ts`: central mock authorization policy, deny by default
- `src/lib/auth/`: sessions, `requireUser` / `requirePermission` (HTTP 403 via `forbidden()`) for pages and server actions, `withAuth` for API routes
- `src/middleware.ts`: coarse session gate plus `x-request-id`. Only `/login` and `POST /api/auth/login` are public; server-action calls without a session cookie get 401.
- `src/lib/audit.ts`: append-only audit log, written inside the same transaction as each change
- `src/lib/ledger.ts`: double-entry ledger (signed integer cents, each transaction sums to zero)
- `src/lib/refunds.ts`: refund queries, approve/reject, and the idempotent `processRefund` payout
- `src/lib/kyc.ts`: KYC Review Queue (claim, release, request info, escalate, approve/reject) and PII masking
- `src/lib/tools.ts`: tool registry; the nav and home page are built from it

## KYC Review Queue

- `/kyc` lists cases with open ones first, sorted by SLA deadline and then risk. `/kyc/[id]` shows identity, checks, documents, notes and history. `GET /api/kyc?status=&mine=1` returns the same list.
- A reviewer claims a case (`in_review`), then approves, rejects, requests info (`needs_info`) or escalates. Every action except claim/release needs a reason, stored in the append-only `kyc_notes` table. Only the reviewer who claimed a case can act on it.
- Escalated cases are decided by admins (`kyc:decide_escalated`). There is no second reviewer for the prototype.
- Only admins (`kyc:view_pii`) see the full date of birth, national ID and street address; everyone else gets masked values from the server. Audit rows never contain PII.
- A refund payout requires the customer's latest KYC case to be approved. `processRefund` checks this inside the payout transaction.

## Authentication behavior

- Sessions last 8 hours, or until 30 minutes idle. Activity is recorded at most every 5 minutes (`session.touch` audit row), so a session expires 30–35 minutes after the last request, never sooner.
- The login form posts to `POST /api/auth/login`, which rejects cross-origin requests.
- An expired or revoked session redirects to `/login?next=<page>&reason=expired`, and the user returns to that page after signing in.
- 5 failed logins for an email within 15 minutes lock that email until the window passes. Failed and blocked attempts are audited (`auth.login_failed`, `auth.login_blocked`). Unknown emails are rejected in the same time as real ones.
- "Sign out everywhere" revokes every session for the current user. Stale sessions are purged at the next login.
