import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/policy";
import { actionItemFor, countRefundsByStatus, listAssignments } from "@/lib/refunds";
import { TOOLS } from "@/lib/tools";
import { StatusBadge } from "@/components/status-badge";
import { RefundActions } from "./refunds/refund-actions";

export default async function HomePage() {
  const user = await requireUser();
  const db = getDb();
  const tools = TOOLS.filter((t) => can(user, t.requires));
  const assignments = can(user, "refund:view") ? listAssignments(db, user) : [];
  const counts = can(user, "refund:view") ? countRefundsByStatus(db, user) : null;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {user.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">Your internal tools and open assignments.</p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Tools</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
            >
              <h3 className="font-medium">{t.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{t.description}</p>
              {t.href === "/refunds" && counts && (
                <p className="mt-3 text-xs text-slate-500">
                  {counts.pending} pending · {counts.approved} awaiting payout
                </p>
              )}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          My assignments ({assignments.length})
        </h2>
        {assignments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            Nothing needs your attention right now.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Refund</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action item</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.map((r) => {
                  const item = actionItemFor(user, r)!;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-3">
                        <Link href={`/refunds/${r.id}`} className="font-mono text-indigo-600 hover:underline">{r.id}</Link>
                      </td>
                      <td className="px-4 py-3">{r.customer_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCents(r.amount_cents, r.currency)}</td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-3">
                        <RefundActions
                          refundId={r.id}
                          version={r.version}
                          idempotencyKey={randomUUID()}
                          label={item.label}
                          intents={item.intents}
                          amountLabel={formatCents(r.amount_cents, r.currency)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
