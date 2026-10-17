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
- `src/middleware.ts`: coarse session gate plus `x-request-id`. Only `/login` is public.
- `src/lib/audit.ts`: append-only audit log, written inside the same transaction as each change
- `src/lib/ledger.ts`: double-entry ledger (signed integer cents, each transaction sums to zero)
- `src/lib/refunds.ts`: refund queries, approve/reject, and the idempotent `processRefund` payout

## Authentication behavior

- Sessions last 8 hours, or 30 minutes idle. Activity is recorded at most every 5 minutes (`session.touch` audit row).
- An expired or revoked session redirects to `/login?next=<page>&reason=expired`, and the user returns to that page after signing in.
- 5 failed logins for an email within 15 minutes lock that email until the window passes. Failed and blocked attempts are audited (`auth.login_failed`, `auth.login_blocked`). Unknown emails are rejected in the same time as real ones.
- "Sign out everywhere" revokes every session for the current user. Stale sessions are purged at the next login.
