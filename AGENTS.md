# devin-fintech-demo: mandatory requirements for every app

These apply to every app built in the laufin16/devin-fintech-demo repo.

1. **Authentication everywhere.** Every API route and server action requires a valid (mock) session and returns 401 without one. There are no public endpoints unless one is explicitly allowlisted.
2. **Central mock policy file.** Every authorization decision lives in one policy file (e.g. `lib/policy.ts`) and goes through a single `can()` / `authorize()` helper.
   - Deny by default: any action not granted returns 403.
   - Always enforce on the server, never only in the UI.
   - Do not scatter role checks through the code.
   - Initial roles are `approver` and `admin` only.
3. **Append-only audit log.** Every state change writes an audit row with actor, action, resource type and id, before/after, timestamp, and request id.
   - The row is written in the **same DB transaction** as the change.
   - Audit rows are insert-only: no update or delete code paths, and the DB enforces this where possible.
4. **Money-moving actions must be consistent.** Enforce all of the following:
   - Idempotency keys, so a retry never moves money twice.
   - Atomic DB transactions: the balance change, ledger entries and audit row commit together or not at all.
   - A double-entry ledger: debits equal credits, and balances are derived from the ledger, never edited directly.
   - Concurrency control (row locks or optimistic version checks) to prevent races and overdrafts.
   - Amounts stored as integer minor units (cents), never floats.

Not adopted (ask before adding): zod input validation on every route, maker-checker, logging denied authorization attempts.
